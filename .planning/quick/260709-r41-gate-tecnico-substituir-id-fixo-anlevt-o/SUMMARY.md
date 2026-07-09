---
id: 260709-r41
slug: gate-tecnico-substituir-id-fixo-anlevt-o
status: complete
completed: 2026-07-09
key_files:
  created:
    - .planning/quick/260709-r41-gate-tecnico-substituir-id-fixo-anlevt-o/PLAN.md
    - .planning/quick/260709-r41-gate-tecnico-substituir-id-fixo-anlevt-o/SUMMARY.md
  modified:
    - apps/backend/src/workflows/order/webhook-order-entrypoint.ts
    - apps/backend/src/workflows/order/__tests__/webhook-order-analytics-outbox.unit.spec.ts
    - .planning/STATE.md
---

# Gate técnico: ID fixo do AnalyticsEventLog

## Resultado

O entrypoint construía um `AnalyticsEventLog` de preview com o ID fixo
`anlevt_order_entrypoint_pending` e o passava à persistência. Agora remove
`id`, `created_at`, `updated_at` e `deleted_at` antes de chamar o módulo.
O módulo gera o ID persistido, evitando colisão entre checkouts distintos.

A chave de idempotência permanece
`purchase_completed:stripe:{payment_intent_id}`. Portanto, replays do mesmo
PaymentIntent continuam reutilizando o registro local, enquanto eventos de
outros checkouts não compartilham um ID fixo.

## Verificação

- 3 suites unitárias focadas / 35 testes passaram.
- Build do backend passou.
- O teste do outbox verifica que o input de criação não contém o ID nem os
  timestamps de preview.

## Limites preservados

Sem migration, alterações de schema, lockfile, configurações, chamadas reais
a provedores ou trabalho da Phase 12.
