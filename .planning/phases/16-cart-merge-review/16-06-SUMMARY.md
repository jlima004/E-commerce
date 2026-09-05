---
phase: 16-cart-merge-review
plan: 06
subsystem: cart-merge
tags: [cart-merge, customer-authority, postgres, advisory-lock, multiprocess]

requires:
  - phase: 16-cart-merge-review
    provides: "Schema cart-merge frozen, receipts/idempotency/capability transaction-aware e provas PostgreSQL disposable dos planos anteriores."
provides:
  - "Resolver Customer discriminado none|single|ambiguous|conflict, sem seleção temporal."
  - "Customer advisory transaction lock compartilhado por POST active e merge."
  - "Prova PostgreSQL multiprocess de canonicalidade, serialização e fail-closed ambiguity."
affects: [phase-16-cart-merge-review, plan-16-07]

actuals:
  tokens: 12500
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Customer authority e carts utilizáveis são lidos/revalidados sob o mesmo transaction manager e lock PostgreSQL."
    - "Barreiras de teste usam processos/conexões PostgreSQL reais; Redis permanece fora da decisão."

key-files:
  created:
    - ".planning/phases/16-cart-merge-review/16-06-SUMMARY.md"
  modified:
    - "apps/backend/src/modules/cart-merge/types.ts"
    - "apps/backend/src/modules/cart-merge/service.ts"
    - "apps/backend/src/api/store/carts/customer-active-cart.ts"
    - "apps/backend/src/api/store/carts/active/route.ts"
    - "apps/backend/integration-tests/http/customer-cart-active.spec.ts"
    - "apps/backend/integration-tests/modules/cart-merge-review.postgres.spec.ts"
    - "apps/backend/integration-tests/helpers/cart-merge-postgres.ts"

key-decisions:
  - "A autoridade Customer retorna none|single|ambiguous|conflict; nenhum vencedor é escolhido por updated_at, sessão, memória ou Redis."
  - "Ambiguous/conflict retorna 409 estável e sanitizado, sem IDs de candidatos, capability touch, idempotency claim, cart/version/review write ou Order."
  - "O lock Customer usa pg_advisory_xact_lock(hashtextextended(customer_id, 1616)) e precede leitura/mutação nos caminhos active e merge."
  - "A Região BRL necessária ao workflow real de criação é preparada idempotentemente somente na suíte disposable."
  - "MRG-01..MRG-08 permanecem OPEN / UNCHANGED; Phase 16 permanece IN PROGRESS."

requirements-completed: []
---

# Phase 16: Cart Merge & Review — Plan 16-06 Summary

**Autoridade Customer PostgreSQL fail-closed e corrida multiprocess comprovadas; HUMAN CLOSEOUT PENDING.**

## Status

- **Phase 16:** **IN PROGRESS**
- **Plan 16-06:** **TECHNICAL PASS — HUMAN CLOSEOUT PENDING**
- **Task 16-06-01:** **PASS** — resolver discriminado, lock compartilhado, POST active/merge e cobertura HTTP.
- **Task 16-06-02:** **PASS** — workers reais, barreiras PostgreSQL, active-vs-active, active-vs-merge, merge-vs-merge e ambiguity pré-existente.
- **Schema identity:** **FROZEN / PASS antes e depois**
- **MRG-01..MRG-08:** **OPEN / UNCHANGED**
- **16-07:** **NOT AUTHORIZED / NOT EXECUTED**
- **Push, provider, Redis remoto, deploy e migration remota:** **NOT PERFORMED**
- **STATE, ROADMAP e counters:** **NOT UPDATED**

## Task Commits

1. **Task 16-06-01:** `1bd8d2a` — `feat(16-06): enforce canonical customer cart authority`
2. **HTTP ambiguity zero-effect coverage:** `057a270` — `test(16-06): cover ambiguous active-cart zero-effect`
3. **Task 16-06-02:** `c2f0465` — `test(16-06): prove customer authority races`

O commit documental deste SUMMARY é separado e local.

## Accomplishments

- `resolveCanonicalCustomerCartAuthority` retorna `none`, `single`, `ambiguous` ou `conflict`; um cart vazio utilizável continua válido, enquanto múltiplos candidatos sem pointer falham fechado.
- Authority pointer e carts utilizáveis são carregados com `FOR UPDATE` depois do lock Customer; pointer stale/foreign/inactive e múltiplas authorities retornam conflito sem fallback temporal.
- `POST /store/carts/active` e `executeCartMerge` compartilham o lock Customer transacional; replay committed é consultado depois do lock e antes da decisão de nova mutação.
- A prova multiprocess usa duas conexões/processos Medusa reais e registra TXIDs sanitizados. Não houve phantom cart, deadlock, capability indevidamente consumida, replay herdado por key diferente ou Order criado.

## Verification Gates

- HTTP exato: **2 suítes / 15 testes PASS**, exit code 0.
- PostgreSQL disposable exato: **1 suíte / 18 testes PASS**, exit code 0; `[P12_DISPOSABLE_POSTGRES_CLEAN]` **PASS**.
- Cenários multiprocess: **active-vs-active**, **active-vs-merge**, **merge-vs-merge** e **ambiguity pré-existente** PASS.
- Build: **PASS** backend/frontend; zero erros de compilação/lint, com warnings globais não bloqueantes já existentes.
- `git diff --check 40cafadc27ebef1dda57c9d703f8e1d7a1ad3378..HEAD`: **PASS**.
- `state validate`: `valid: true`, `warnings: []`, `drift: {}`.
- Worktree antes do SUMMARY: **limpo**; diff técnico desde `40cafad` contém exatamente os sete arquivos autorizados.
- Validação independente final: **PASS**, repetiu HTTP, PostgreSQL/cleanup, build, schema SHA, escopo e worktree no `HEAD c2f0465`.
- Order delta: **0** nos cenários PostgreSQL; Redis permanece desligado/fora da decisão.
- Leakage: erros de ambiguity não incluem IDs de carts/candidatos; capability token, DSN e credenciais não são expostos.

## Schema Identity SHA-256

O exact-set foi recalculado no fechamento técnico e permaneceu byte-identical:

```text
SCHEMA_IDENTITY_SHA256_BEGIN
d4e625bf2f467d7f9f8358d637e4803f4672fb6d8bf47dc97ceb5746df7f3849  apps/backend/src/modules/cart-merge/migrations/.snapshot-cart-merge.json
3a1f141e4f6269a7f7a579371c8ceeb9916da88e7681673ac4408d6cec2b6522  apps/backend/src/modules/cart-merge/migrations/Migration20260824160628.ts
381f7683377a74a9b29f55ad074bbe89c796e708a8d43adf18fb3417aefbbd90  apps/backend/src/modules/cart-merge/models/cart-merge-result.ts
3779a10be4d8a05be6146768c25bdd6d73d9cbe909aec222102d1874ed526dea  apps/backend/src/modules/cart-merge/models/cart-review.ts
14c85b8e5afa579892330438cc1988afdd247cc87a8b810f84692685ee7095c1  apps/backend/src/modules/cart-merge/models/customer-cart-authority.ts
SCHEMA_IDENTITY_SHA256_END
```

Nenhum model, migration ou snapshot foi alterado.

## Deviations and Issues

- O runner real exigiu uma Região BRL no banco disposable; a suíte passou a garantir essa dependência idempotentemente dentro do teste, sem tocar runtime de produção ou schema.
- A coordenação usou generic-agent workaround porque não havia papel tipado callable nesta sessão; a sequência foi mantida e a validação independente final passou.
- Falhas intermediárias de bootstrap/IPC do worker foram corrigidas apenas nos arquivos da allowlist e cobertas pelo runner final; não há blocker técnico residual.

## Limits of Closeout

Este SUMMARY registra **TECHNICAL PASS**, não `HUMAN APPROVED`. MRG-01..MRG-08 continuam abertos; nenhum contador, STATE ou ROADMAP foi atualizado. O próximo passo é **HUMAN CLOSEOUT REVIEW** deste Plan 16-06. Nenhuma ação posterior, incluindo Plan 16-07, é automática ou autorizada por este documento.

## User Setup Required

None — nenhuma configuração externa foi necessária.

---
*Phase: 16-cart-merge-review*
*Plan: 16-06*
*Technical execution: PASS; human closeout pending; 16-07 not authorized*
