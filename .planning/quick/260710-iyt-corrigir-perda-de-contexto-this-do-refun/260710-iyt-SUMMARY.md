---
id: 260710-iyt
slug: corrigir-perda-de-contexto-this-do-refun
status: complete
completed: 2026-07-10
scope: hotfix-local-manual-gate
key_files:
  modified:
    - apps/backend/src/api/admin/refunds/request/route.ts
    - apps/backend/integration-tests/http/admin-refunds.spec.ts
  created:
    - .planning/quick/260710-iyt-corrigir-perda-de-contexto-this-do-refun/260710-iyt-PLAN.md
    - .planning/quick/260710-iyt-corrigir-perda-de-contexto-this-do-refun/260710-iyt-SUMMARY.md
    - .planning/quick/260710-iyt-corrigir-perda-de-contexto-this-do-refun/260710-iyt-VERIFICATION.md
---

# Quick Task 260710-iyt — contexto do RefundRequest preservado

## Resultado

`POST /admin/refunds/request` deixou de extrair `listRefundRequests` e
`createRefundRequests` da instância. As chamadas agora são feitas diretamente
por `refundRequestModule`, preservando o `this` de um `MedusaService` e, por
consequência, o acesso interno a `baseRepository_`.

O entrypoint `stripe-refund-webhook-entrypoint.ts` foi auditado e não tinha o
mesmo padrão: todas as invocações existentes usam a instância.

## Regressão e validação

- O novo teste fornece métodos que exigem `this.baseRepository_`; a primeira
  solicitação retorna 201, o replay retorna 200 e só uma reserva é persistida.
- HTTP Admin refund: 9 testes PASS.
- Regras de RefundRequest + entrypoint de webhook: 45 testes unitários PASS.
- HTTP do webhook Stripe refund: 8 testes PASS.
- Build isolado com `ADMIN_DISABLED=true`: PASS.
- `git diff --check`: PASS; nenhum `package.json` ou lockfile foi alterado.

Os comandos inicialmente fornecidos não encontraram ambos os arquivos porque
o script do workspace separa `integration-tests/http` de testes unitários. As
mesmas suítes foram executadas pelos scripts e caminhos compatíveis acima.

## Não-ações e gate

Nenhum refund Stripe, `refund_request` manual, migration, alteração de
configuração/segredos, pacote/lockfile, `sk_live`, Phase 12 ou chamada externa
foi executada. O smoke remoto continua dependente do gate manual já registrado
em `260710-dz0`.
