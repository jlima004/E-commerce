---
phase: 16-cart-merge-review
plan: 01
subsystem: cart-merge
tags: [cart-merge, medusa, postgres, idempotency, capability, etag]

requires:
  - phase: 15-guest-cart-capability-concurrency
    provides: "Guest capability, cart versioning, idempotency and canonical Order-authority foundations."
provides:
  - "Wave 0 transactional cart-merge tracer with real Medusa module resolution."
  - "Unit, HTTP and disposable PostgreSQL evidence for the first GUEST_CART_ATTACHED slice."
  - "Documentary closeout record for Plan 16-01; later plans and milestone requirements remain open."
affects: [phase-16-02, cart-merge-review]

tech-stack:
  added: []
  patterns:
    - "The canonical cart merge route resolves the real cart_merge module through the Medusa container."
    - "Cart, version, capability and idempotency mutations share one Medusa transaction manager and rollback boundary."
    - "PostgreSQL is the correctness authority; disposable loopback PostgreSQL is used for evidence and remote infrastructure is excluded."

key-files:
  created:
    - ".planning/phases/16-cart-merge-review/16-01-SUMMARY.md"
    - "apps/backend/src/modules/cart-merge/index.ts"
    - "apps/backend/src/modules/cart-merge/service.ts"
    - "apps/backend/src/api/store/customers/me/cart/merge/route.ts"
    - "apps/backend/src/modules/cart-merge/__tests__/decision.unit.spec.ts"
    - "apps/backend/integration-tests/helpers/cart-merge-postgres.ts"
    - "apps/backend/integration-tests/modules/cart-merge-review.postgres.spec.ts"
  modified:
    - "apps/backend/medusa-config.ts"
    - "apps/backend/src/infrastructure/__tests__/medusa-config.unit.spec.ts"
    - "apps/backend/src/modules/store-idempotency/operations.ts"
    - "apps/backend/src/modules/store-idempotency/service.ts"
    - "apps/backend/integration-tests/http/cart-merge-review.spec.ts"
    - "apps/backend/integration-tests/modules/guest-cart-order-invariants.postgres.spec.ts"

key-decisions:
  - "O primeiro slice cobre somente a promoção integral do guest sem destino Customer utilizável e retorna GUEST_CART_ATTACHED."
  - "A versão fornecida pelo request é exclusivamente a versão do guest source; a versão do destino Customer permanece server-authoritative."
  - "CUSTOMER_CART_PRESERVED permanece apenas no enum, sem branch positiva ou fixture positiva."
  - "payment_intent.succeeded permanece a autoridade canônica exclusiva para criação de Order; o tracer não cria Order."
  - "A remediação aceita preserva o shared Medusa transaction manager e a autoridade real de Cart, StoreResourceVersion, GuestCartCapability e StoreIdempotency."
  - "Nenhum provider, deploy, push, infraestrutura remota ou operação fora do PostgreSQL descartável/loopback foi executado."

requirements-completed: []
---

# Phase 16: Cart Merge & Review — Plan 16-01 Summary

**Wave 0 do tracer de cart merge transacional entregue com wiring real do container Medusa, rollback PostgreSQL e autoridade de Order preservada.**

## Status

- **Phase:** 16 — Cart Merge & Review
- **Plan:** 16-01
- **Wave:** 0
- **Status:** **COMPLETE / ready for human closeout**
- **Task 16-01-01:** **HUMAN APPROVED — PASS**
- **B16-01-HR-01:** **CLOSED — PASS**
- **Task 16-01-02:** **HUMAN APPROVED — PASS**
- **B16-01-HR-02:** **CLOSED — PASS**
- **B16-01-HR-03:** **CLOSED — PASS**
- **Plan 16-01 implementation:** **COMPLETE**
- **Plan 16-01:** **TECHNICALLY COMPLETE / AWAITING HUMAN CLOSEOUT**
- **16-02:** **NOT STARTED / NOT AUTHORIZED**
- **MRG-01..MRG-08:** **OPEN / UNCHANGED**
- **Phase 16 inteira:** não declarada completa
- **Milestone:** não declarada completa

## PHASE16_BASE_COMMIT

PHASE16_BASE_COMMIT=c11823ae11d79b01d644df80f944b91ab75faf3d

O valor acima foi validado como commit existente e como pai direto do primeiro
commit RED `1c8ab25c6105d17b4953f16e25fd4fb99936172b`.

## Entrega técnica aceita

- módulo `cart_merge` registrado uma única vez e resolvido pelo container real Medusa;
- endpoint canônico `POST /store/customers/me/cart/merge`;
- primeiro tracer `GUEST_CART_ATTACHED`;
- BFF + Customer + guest capability + `Idempotency-Key` + guest `If-Match`;
- guest source version como única versão fornecida pelo request;
- Customer destination server-authoritative;
- shared Medusa transaction manager preservado;
- Cart real + StoreResourceVersion + GuestCartCapability + StoreIdempotency no mesmo commit transacional;
- rollback real antes do commit;
- stale `If-Match` retorna `412` sem efeito;
- `normalizedGuestIntent` agregado e ordenado;
- `CUSTOMER_CART_PRESERVED` continua enum-only, sem branch positiva;
- `Order delta = 0` no happy path real;
- `payment_intent.succeeded` continua autoridade canônica de criação de Order;
- nenhuma operação de provider, deploy ou remote infra;
- PostgreSQL usado somente de forma descartável/loopback.

O body e o ETag do caminho aceito são derivados do mesmo snapshot transacional.
O request não fornece Customer destination nem uma segunda versão de ETag.
Falhas técnicas permanecem fail-closed e revertem associação, versão,
capability e idempotência antes do commit.

## Validações finais aceitas

As contagens abaixo preservam a evidência final aceita no checkpoint técnico e
humano. Este closeout documental não reroda as suites de implementação.

| Validação | Resultado |
|---|---|
| Unit | **3/3 PASS** |
| HTTP | **4/4 PASS** |
| PostgreSQL real | **3/3 PASS** |
| Rollback íntegro | **PASS** |
| Order delta | **0** |
| Build | **PASS** |
| `git diff --check` | **PASS** |
| State validation | **PASS** |
| Worktree final antes do SUMMARY | **CLEAN** |

O PostgreSQL real foi descartável e local/loopback, com cleanup registrado;
nenhuma prova dependeu de Order em memória, provider real, Redis como autoridade
ou DSN remoto.

## Commits do Plan 16-01

Os commits técnicos pertencentes ao Plan 16-01, em ordem cronológica, são:

1. **RED tracer HTTP** — `1c8ab25c6105d17b4953f16e25fd4fb99936172b` — `test(16-01): add failing cart merge tracer`.
2. **Implementação do tracer e wiring inicial** — `515976cde11e27750068a682c56b8a85f90b3466` — `feat(16-01): implement cart merge tracer`.
3. **Resolução pelo container Medusa real** — `e1b99392752249212e525fd00200edfedcea402d` — `test(16-01): resolve cart merge through real module wiring`.
4. **Task 16-01-02 / validação Wave 0** — `500ae5c7520c45beffc3f947aa4a88ce09da8162` — `test(16-01): materialize Wave 0 validation`.
5. **Remediação PostgreSQL/shared-context e consolidação final** — `db33fc42d76c67d5bc7f52b7f101d09a95fa0171` — `fix(phase-16): complete cart merge remediation`.

Os cinco SHAs completos foram resolvidos e validados como commits existentes.
O commit documental deste arquivo é separado dos commits técnicos acima; não
há push.

## Limites do fechamento

Este SUMMARY registra somente o fechamento técnico/documental do Plan 16-01.
Não declara MRG-01..MRG-08, a Phase 16 inteira, o milestone, o Plan 16-02 ou
qualquer plano posterior como completos.

Não foram alterados por este closeout:

- código de produção;
- testes;
- `.planning/STATE.md`;
- `.planning/ROADMAP.md`;
- `.planning/REQUIREMENTS.md`;
- contadores de milestone;
- artefatos OpenAPI;
- providers, deploy ou infraestrutura remota.

O `16-02-PLAN.md` permanece somente como plano futuro não iniciado e não
autorizado nesta operação.

## Next Phase Readiness

- Plan 16-01: **TECHNICALLY COMPLETE / AWAITING HUMAN CLOSEOUT**.
- Plan 16-02: **NOT STARTED / NOT AUTHORIZED**.
- MRG-01..MRG-08: **OPEN / UNCHANGED**.
- Worktree após o commit documental: deve permanecer **CLEAN**.
- Push: **NOT PERFORMED**.

---
*Phase: 16-cart-merge-review*
*Plan: 16-01*
*Technical execution: complete; documentary closeout recorded on 2026-08-24*
