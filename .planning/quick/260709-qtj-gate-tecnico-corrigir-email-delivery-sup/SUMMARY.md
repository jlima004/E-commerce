---
id: 260709-qtj
slug: gate-tecnico-corrigir-email-delivery-sup
status: complete
completed: 2026-07-09
key_files:
  created:
    - .planning/quick/260709-qtj-gate-tecnico-corrigir-email-delivery-sup/PLAN.md
    - .planning/quick/260709-qtj-gate-tecnico-corrigir-email-delivery-sup/SUMMARY.md
  modified:
    - apps/backend/src/modules/email-delivery-log/service.ts
    - apps/backend/src/workflows/order/webhook-order-entrypoint.ts
    - apps/backend/src/workflows/order/__tests__/webhook-order-email-enqueue.unit.spec.ts
    - apps/backend/src/workflows/order/__tests__/webhook-order-creation.unit.spec.ts
    - apps/backend/src/workflows/order/__tests__/webhook-order-entrypoint.unit.spec.ts
    - apps/backend/src/workflows/order/__tests__/webhook-order-analytics-outbox.unit.spec.ts
    - apps/backend/src/workflows/order/__tests__/webhook-order-gelato-eligibility.unit.spec.ts
    - .planning/STATE.md
---

# Gate técnico: e-mail não configurado no webhook Stripe

## Resultado

`EMAIL_DELIVERY_SUPPORT_EMAIL_NOT_CONFIGURED` é lançado exclusivamente por
`resolveOrderConfirmationSupportEmail()` quando `SUPPORT_EMAIL` está ausente.
O webhook agora só tenta criar o `EmailDeliveryLog` quando o relay Resend está
configurado por completo: `RESEND_ORDER_CONFIRMATION_ENABLED=true`,
`RESEND_API_KEY` e `RESEND_FROM_EMAIL` não vazios. Nesse estado habilitado,
`SUPPORT_EMAIL` continua obrigatório para montar o conteúdo do e-mail.

Com o provider ausente ou incompleto, o entrypoint preserva Order e o outbox
local `purchase_completed`, não resolve o módulo de e-mail, não registra um
`EmailDeliveryLog` inválido e não tem caminho para chamada ao Resend. Assim a
rota Stripe recebe um resultado terminal de Order e pode marcar o
`WebhookEventLog` como `processed` pela sua guarda já existente.

## Verificação

- `TMPDIR=/tmp npm run test:unit -w @dtc/backend -- --runTestsByPath ...`:
  6 suites focadas passaram, incluindo webhook Stripe, Order, analytics,
  e-mail e elegibilidade Gelato.
- `HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build -w @dtc/backend` passou.
- `git diff --check` passou.

## Limites preservados

Sem migration, lockfile, configuração/segredo real, chamada real a Resend,
Stripe, Gelato ou Correios, e sem trabalho da Phase 12.
