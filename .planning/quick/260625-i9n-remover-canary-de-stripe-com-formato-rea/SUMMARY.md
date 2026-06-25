---
quick_id: 260625-i9n
slug: remover-canary-de-stripe-com-formato-rea
status: complete
completed_at: "2026-06-25T16:09:10.752Z"
---

# Summary

Concluido: removido dos testes de observabilidade o canary Stripe com formato real que acionava o GitHub Push Protection.

## Arquivos alterados

- `apps/backend/src/observability/__tests__/logger.unit.spec.ts`
- `apps/backend/src/observability/__tests__/redaction.unit.spec.ts`

## Validacao

- `rg -n "sk_live_" apps/backend/src/observability` (sem canary com formato de chave real)
- `TMPDIR=/tmp npm --prefix apps/backend run test:unit -- src/observability/__tests__/redaction.unit.spec.ts src/observability/__tests__/logger.unit.spec.ts`
- `git log --oneline origin/gsd/phase-01-foundation-observability..HEAD -- apps/backend/src/observability/__tests__/logger.unit.spec.ts apps/backend/src/observability/__tests__/redaction.unit.spec.ts`
