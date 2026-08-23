# Phase 16: Cart Merge & Review — Research Human Review

**Reviewed:** 2026-08-22
**Research artifact:** `.planning/phases/16-cart-merge-review/16-RESEARCH.md`
**Research commit reviewed:** `f26af46b94270ac8d2ec607f4433a210c84f1c64`
**Gate:** RESEARCH HUMAN APPROVED — PASS
**Research blockers:** 0
**Next gate:** PLAN AUTHORIZED — NOT STARTED

## Authority

Este artefato fecha formalmente o human-review gate do RESEARCH da Phase 16.
Ele preserva D16-01..D16-42 e não altera `MRG-01..MRG-08`, que permanecem OPEN.
As decisões `R16-HR-01..R16-HR-08` abaixo são vinculantes para o PLAN e
prevalecem sobre qualquer recommendation, inference ou `OPEN DECISION`
conflitante presente no `16-RESEARCH.md` pesquisado antes desta revisão.

## R16-HR-01 — `CUSTOMER_CART_PRESERVED` reservado e inalcançável

- O literal permanece no enum/contrato.
- Nenhum branch positivo, fixture positiva ou regra de domínio será inventado.
- O outcome só poderá tornar-se alcançável após regra determinística aprovada em gate humano futuro.
- Esta lacuna não bloqueia PLAN para os demais outcomes.

## R16-HR-02 — Promoção sem Customer com aceitação parcial

```text
0 Customer destination
+ accepted > 0
+ rejected = 0
→ GUEST_CART_ATTACHED

0 Customer destination
+ accepted > 0
+ rejected > 0
→ MERGED_PARTIAL
→ guest pode tornar-se o cart Customer canônico
→ requiresReview=true
```

`GUEST_CART_ATTACHED` fica restrito à promoção com preservação integral da intenção guest.

## R16-HR-03 — Review pendente bloqueia mutações estruturais

Enquanto `requiresReview=true`, qualquer nova mutação estrutural do cart,
inclusive novo merge, falha fechado com `409 REVIEW_REQUIRED`. Cart, review,
versão e capability permanecem inalterados. Somente ACK válido limpa a review.
Após ACK, mutações voltam a ser permitidas sem reativar review; somente novo
`MERGED_PARTIAL` cria nova review.

## R16-HR-04 — Replay devolve resultado original imutável

Same-key/same-fingerprint `COMMITTED` reproduz semanticamente:

```text
original outcome
original public cart snapshot
original review state
original ETag
```

Não refazer fetch do cart atual, não misturar estados temporais e não adicionar
`mergeReceipt` público. Persistir apenas a projeção pública allowlisted mínima
necessária ao replay e os bindings internos permitidos.

## R16-HR-05 — Acknowledge sem `Idempotency-Key`

Contrato aprovado:

```ts
{
  reviewRef: string | null
}
```

- `If-Match` é obrigatório em todos os casos.
- `reviewRef: string` reconhece a pending atual ou repete ACK compatível já reconhecido.
- `reviewRef: null` é no-op somente quando não há pending.
- `pending + null` falha fechado.
- ref desconhecido/divergente/foreign falha fechado.
- `Idempotency-Key` não deve ser introduzido no ACK nesta Phase.

## R16-HR-06 — Retenção coordenada com idempotência

- `CartMergeResult` usa a mesma política de retenção do `StoreIdempotency` associado.
- `CartReview.pending` vive enquanto estiver pending.
- Após `acknowledged`/terminal, preservar review ao menos enquanto o merge receipt associado puder ser reexecutado/reconhecido.
- Purga posterior deve ser coordenada; nenhum TTL arbitrário novo é criado nesta Phase.

## R16-HR-07 — Persisted cart state inválido falha fechado

Guest line sem identificador público seguro de variante ou Customer cart com
duplicatas físicas incompatíveis não é reparado implicitamente e não vira
`VARIANT_INVALID` artificialmente.

```text
malformed/inconsistent persisted cart state
→ stable 409 state conflict
→ zero cart mutation
→ capability not consumed
→ no review
→ no Order
```

D16-09 continua normalizando apenas intenção guest válida identificável por variante.

## R16-HR-08 — `If-Match` do merge referencia o guest source

```text
merge If-Match
→ guest source resource version

Customer destination version
→ resolved server-side
→ locked/revalidated transactionally
→ included in authoritative fingerprint
```

Não introduzir segundo ETag/header nem `customerCartVersion` no body nesta Phase.

## Gate Result

```text
Phase 16 CONTEXT: HUMAN APPROVED — PASS
Phase 16 RESEARCH: HUMAN APPROVED — PASS
R16-HR-01..R16-HR-08: CLOSED — APPROVED
Research blockers: 0
MRG-01..MRG-08: OPEN / UNCHANGED
Phase 16 PLAN: AUTHORIZED — NOT STARTED
Phase 16 EXECUTION: NOT AUTHORIZED
```

PLAN authorization does not authorize SPEC/SDD, implementation, execution,
deploy/release, real providers, remote DB/Redis or frontend. The next permitted
action is **EXECUTE PHASE 16 PLAN ONLY**.
