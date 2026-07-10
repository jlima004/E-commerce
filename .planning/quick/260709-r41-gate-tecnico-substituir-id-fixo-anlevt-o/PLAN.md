---
id: 260709-r41
slug: gate-tecnico-substituir-id-fixo-anlevt-o
status: complete
---

# Gate técnico: remover ID fixo do AnalyticsEventLog

## Escopo

1. Não persistir o ID de preview `anlevt_order_entrypoint_pending` na criação do outbox `purchase_completed`.
2. Preservar a chave de idempotência canônica por PaymentIntent e usar o ID gerado pelo módulo na persistência.
3. Cobrir dois checkouts distintos e provar que o input de criação não contém o ID de preview.

## Fora de escopo

- migrations, alterações de schema, package/lockfile ou configuração;
- chamadas reais a Stripe, PostHog, Resend, Gelato ou Correios;
- mudanças no fluxo de e-mail recém-corrigido ou trabalho da Phase 12.
