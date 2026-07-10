---
id: 260710-iyt
slug: corrigir-perda-de-contexto-this-do-refun
status: ready
created: 2026-07-10
scope: hotfix-local-manual-gate
must_haves:
  truths:
    - O endpoint Admin preserva o contexto da instância RefundRequest ao listar e criar reservas.
    - A primeira solicitação retorna 201 e o replay da mesma chave retorna 200 sem duplicar a reserva.
  artifacts:
    - apps/backend/src/api/admin/refunds/request/route.ts
    - apps/backend/integration-tests/http/admin-refunds.spec.ts
  key_links:
    - A rota chama listRefundRequests e createRefundRequests pela instância resolveda.
    - O teste usa métodos que leem baseRepository_ via this.
---

# Quick Task 260710-iyt: preservar `this` no RefundRequest MedusaService

## Escopo

Corrigir a extração desacoplada de métodos do `RefundRequest` no endpoint
`POST /admin/refunds/request`; auditar o entrypoint de webhook indicado e
adicionar uma regressão que falha quando `this` não é preservado.

## Tarefas

1. Substituir as invocações indiretas por chamadas na instância
   `refundRequestModule`, mantendo validação, reserva e respostas existentes.
2. Cobrir criação e replay idempotente com um módulo de teste cujos métodos
   dependem de `this.baseRepository_`.
3. Executar os testes e build fornecidos, `git diff --check` e a prova de que
   nenhum package/lockfile mudou. Não executar Stripe nem qualquer mutação
   manual de dados.

## Limites

- Sem Stripe, `refund_request` manual, migration, Phase 12, pacote/lockfile,
  segredo/configuração ou `sk_live`.
- O workflow `stripe-refund-webhook-entrypoint.ts` será apenas auditado; já usa
  chamadas na instância e não deve ser alterado sem ocorrência concreta.
