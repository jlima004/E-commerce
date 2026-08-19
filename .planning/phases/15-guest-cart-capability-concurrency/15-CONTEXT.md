---
phase: 15-guest-cart-capability-concurrency
milestone: v1.1-backend-storefront-readiness
status: context-complete-awaiting-human-review
created_at: 2026-08-19
scope: context-only
requirements: [CART-01, CART-02, CART-03, CART-04, CART-05, CART-06, CART-07, CART-08, CART-09]
manual_review_gate: true
research_status: not-started-not-authorized
plan_status: not-started-not-authorized
implementation_status: not-authorized
frontend: blocked
depends_on: [13-CLOSED, 14-CLOSED]
---

# Phase 15: Guest Cart Capability & Concurrency - Context

**Gathered:** 2026-08-19
**Status:** CONTEXT COMPLETE — AWAITING HUMAN REVIEW
**Next permitted step:** human review of this CONTEXT; RESEARCH remains blocked

<domain>
## Phase Boundary

**Milestone:** `v1.1 — Backend Storefront Readiness`
**Phase:** `15 — Guest Cart Capability & Concurrency`
**Sequence:** `13 → 14 → 15 → 16 → 17 → 18 → 19 → 20 → 21 → 22`

### Goal

Substituir a sessão (`req.session.active_cart_id`) como prova principal de posse
do carrinho convidado por uma capability opaca e tornar mutações concorrentes
seguras, cobrindo `CART-01..CART-09`.

### Problem to solve

O as-built v1.0 ainda trata a sessão como prova principal de posse do carrinho
convidado (`GET/POST /store/carts/active` em `PRESERVE_LEGACY`). O primitivo
`StoreResourceVersion` existe e está comprovado, mas **não está ligado** ao
contrato público de Cart (`ETag` / `If-Match`). Mutações nativas de line-item
permanecem `EXTENDED → DENY` com `owner_phase: 15`. Sem este gate, o futuro
BFF não pode operar um carrinho convidado com posse não enumerável nem
concorrência otimista.

Este artefato fecha somente o CONTEXT. Ele não pesquisa, não planeja e não
implementa persistência, rotas, OpenAPI executável, testes ou promoção de
`PRESERVE_LEGACY` / `DENY` para `M1_ENABLED`.

### ROADMAP thinness (do not invent)

A seção da Phase 15 em `.planning/ROADMAP.md` contém goal, status e
autorização de CONTEXT. **Não** lista success criteria, IDs de requisito,
deliverables, canonical refs nem out-of-scope. Este CONTEXT deriva o boundary
de `.planning/REQUIREMENTS.md` (`CART-01..CART-09`), PRD Backend §7.2–7.3,
SRS-BE-CART-001..008 e closures das Phases 13/14. Não inventa uma lista de
sucesso além do que esses documentos já afirmam.

</domain>

## Problem Statement

| Hoje (as-built pós-Phase 14) | Proibido / insuficiente | Alvo da Phase 15 (quando executada) |
|---|---|---|
| `req.session.active_cart_id` prova posse | sessão não é capability opaca; enumerável / acoplada a cookie de sessão | CSPRNG ≥ 32 bytes; persistir somente hash; header `x-indicio-guest-cart-token` |
| `GET/POST /store/carts/active` = `PRESERVE_LEGACY` | `PRESERVE_LEGACY` ≠ autorização M1 | create/get lazy e idempotente com estado canônico |
| line-items nativos `EXTENDED → DENY` | BFF não pode add/update/delete/clear no contrato M1 | mutações reutilizando engine Medusa, sem segundo carrinho |
| `StoreResourceVersion` unwired ao Cart público | lost update / aba stale | versão monotônica + `ETag` / `If-Match` / `412 CART_VERSION_MISMATCH` |
| invalidação de PaymentAttempt existe; quote/select não | CART-09 menciona quote/seleção que só existem na Phase 18 | invalidar o que existir; não implementar Gelato quote |

## Scope

### In scope (CONTEXT of CART-01..CART-09)

- Prova principal de posse do carrinho convidado por capability opaca (CART-01).
- Transporte da capability apenas em `x-indicio-guest-cart-token` (CART-02).
- Validação de ownership, expiração e revogação; encerrar acesso quando o
  carrinho expirar, for consumido ou concluído (CART-03).
- Create/get lazy e idempotente do carrinho convidado, devolvendo estado
  canônico (CART-04).
- Add / update / delete / clear de line item reutilizando operações Medusa
  nativas quando adequadas, sem segundo motor de carrinho (CART-05).
- Quantidade inteira 1–99; remoção explícita; rejeição de negativo, decimal e
  valor acima do teto (CART-06).
- Versão monotônica em mudança estrutural relevante (CART-07).
- `ETag` em respostas versionadas; `If-Match` em mutações; `412 CART_VERSION_MISMATCH`
  com snapshot canônico seguro (CART-08).
- Invalidar quote, seleção de frete e tentativa de pagamento incompatíveis após
  mutação estrutural, e provar ausência de bypass por rota nativa (CART-09).
- Consumir autoridades fechadas das Phases 13 e 14 sem reabri-las.
- Rastreabilidade FE (não são requisitos extras): `FE-CART-001..005`,
  `FE-CART-008`; `FE-PAY-006` cruza CART-09 e PAY-07 (Phase 19).

### Explicitly out of scope

- RESEARCH, PLAN, SPEC/SDD, implementação, testes, migrations, OpenAPI writer,
  package.json/lockfiles.
- Frontend / Next.js / BFF implementação; browser-direct Medusa.
- Deploy, release, providers reais, DB/Redis remotos, auto-chain.
- **Phase 16** — merge/review (`MRG-01..MRG-08`, `FE-CART-006/007`). Consumo da
  capability no merge bem-sucedido já está especificado; **não** é entrega desta
  phase.
- **Phase 17** — checkout autenticado BR, CPF, consentimento. Checkout guest é
  fora de escopo v1.1 (`CHK-01`; SRS 2.4).
- **Phase 18** — cotação/seleção Gelato (`SHP-*`). Rotas nativas de
  shipping-methods permanecem DENY.
- **Phase 19** — hardening M1 de PaymentAttempt / remoção de pagamento guest
  (`PAY-*`). Card/Pix continuam `PRESERVE_LEGACY` (Pix fora do Frontend M1).
- Phases 20–22 — confirmação assíncrona, order/catalog, contract kit.
- Pix no Frontend M1; tracking UI; saved addresses; cupons; CNPJ; multi-currency;
  troca self-service.
- Reescrita do webhook Stripe ou do pipeline Order → purchase_completed →
  Resend → Gelato.
- Reabrir `D13-*` / `D14-*`, exact-sets Auth/Store da Phase 14, ou o significado
  de `PRESERVE_LEGACY`.

SRS 2.4 (normativo para o visitante M1): o visitante **pode** navegar e operar
um carrinho convidado; **não deve** persistir endereço de checkout, cotar ou
selecionar frete, criar `PaymentAttempt` nem confirmar pagamento.

## Requirements Covered

Nenhum `CART-*` está COMPLETE neste gate. IDs abaixo são a autoridade v1.1.
**Não confundir** com `CART-01..CART-04` arquivados da v1.0 Phase 3
(`.planning/milestones/v1.0-REQUIREMENTS.md`).

| ID | Classe | Requisito verificável | Completion now |
|---|---|---|---|
| CART-01 | Persistência | Substituir `req.session.active_cart_id` como prova principal de posse por capability CSPRNG de pelo menos 32 bytes, persistida somente como hash. | open |
| CART-02 | Segurança | Transportar a capability apenas em `x-indicio-guest-cart-token`, nunca em JSON, URL, logs, Sentry, analytics ou exemplos. | open |
| CART-03 | Runtime | Validar ownership, expiração e revogação da capability e encerrá-la quando o carrinho expirar, for consumido ou concluído. | open |
| CART-04 | Runtime | Criar/recuperar carrinho convidado de forma lazy e idempotente, retornando o estado canônico do carrinho. | open |
| CART-05 | Runtime | Expor add/update/delete/clear de line item reutilizando operações Medusa nativas quando adequadas, sem segundo motor de carrinho. | open |
| CART-06 | Runtime | Aceitar quantidade inteira entre 1 e 99, tratar remoção explicitamente e rejeitar negativos, decimais e valores acima do teto. | open |
| CART-07 | Persistência | Incrementar versão monotônica em toda mudança estrutural relevante do carrinho. | open |
| CART-08 | Contrato | Retornar `ETag`, exigir `If-Match` nas mutações e responder `412 CART_VERSION_MISMATCH` com snapshot canônico seguro. | open |
| CART-09 | Runtime | Invalidar quote, seleção de frete e tentativa de pagamento incompatíveis após mutação estrutural e provar ausência de bypass por rota nativa. | open |

### Inherited requirements (constrain Phase 15; not assigned)

| ID | Constraint | Status |
|---|---|---|
| FND-01..FND-08 | Superfície fail-closed, Order-birth, erros, idempotência, versão, BFF, OpenAPI 1.1.0 | COMPLETE (Phase 13) |
| AUTH-01..AUTH-09 | Exact-set Auth/Store M1; expiração de sessão preserva carrinho | COMPLETE (Phase 14) |
| AUTH-02 | Sessão inicial não verificada pode comprar; Phase 15 não redefine política de auth | COMPLETE |
| MRG-01..MRG-08 | Merge/review/depreciação de attach | Phase 16 — not started |
| CHK-01 | Checkout M1 exige Customer autenticado; guest checkout proibido | Phase 17 |
| SHP-* | Quote/select | Phase 18 |
| PAY-01 / PAY-07 | Pagamento guest fora do contrato M1; invalidação cruza CART-09 | Phase 19 |

## Dependencies

```text
v1.0 Phase 03 session cart (archived CART-01..04)
  → Phase 13 CLOSED — FND-01..08, StoreResourceVersion, BFF, OpenAPI 1.1.0
    → Phase 14 CLOSED — AUTH-01..09, exact-sets, zero-Order proof
      → Phase 15 CONTEXT ONLY — CART-01..09
        → Phase 16 Cart Merge & Review
          → Phase 17 Authenticated BR Checkout
            → … → Phase 22
```

**Depends on (must consume, must not reopen):**

- Phase 13 closure: `.planning/phases/13-storefront-contract-foundation-surface-lockdown/13-CLOSURE.md`
- Phase 13 FND-06: `StoreResourceVersion` comprovado; wiring público de Cart
  ETag/If-Match explicitamente deixado para Phase 15 (`13-05-SUMMARY.md`)
- Phase 14 closure: `.planning/phases/14-customer-auth-verification/14-CLOSURE.md`
- Technical head consumido pela Phase 14: `3d12565d74e9688883d6e042fdebca79ffebf7de`

**Phase 15 must not pull forward** Phases 16–22.

## Architectural Invariants

1. **Order-birth:** `Order` nasce somente após o webhook canônico Stripe
   `payment_intent.succeeded`. Caminhos síncronos Store/BFF/browser criam zero
   Orders. `POST /store/carts/{id}/complete` permanece BLOCKED+DENY com override
   local.
2. **BFF boundary:** `Browser → same-origin BFF → Medusa server-to-server`.
   Browser-direct Medusa é proibido. JWT, publishable key, guest capability e
   confirmation session não atravessam o navegador (D13-01, D13-02, SRS 3.1–3.2).
3. **Auth exact-set (Phase 14, não encolher nem inventar extras):**
   - `POST /auth/customer/emailpass/register`
   - `POST /auth/customer/emailpass`
   - `POST /auth/token/refresh`
   - `POST /auth/customer/emailpass/revoke-current-lineage`
   - `POST /auth/customer/emailpass/reset-password`
   - `POST /auth/customer/emailpass/update`
   Primitivos Auth nativos, `/auth/session`, callbacks, MFA, social/passwordless
   e `POST /store/customers` cru permanecem DENY/ausentes.
4. **Store `M1_ENABLED` exact-set fechado na Phase 14 (6 rotas).** Phase 15
   *execução futura* pode promover operações de cart; este CONTEXT **não** trata
   o conjunto de 6 como já incluindo cart. Não silenciar as 6 existentes.
5. **`PRESERVE_LEGACY` ≠ `M1_ENABLED`.** Compatibilidade runtime das 7 rotas
   v1.0-aceitas, não autorização M1 nem promoção OpenAPI executável. Inclui
   `GET/POST /store/carts/active`.
6. **Não reabilitar nativos DENY:** `POST /store/carts`, `GET/POST /store/carts/{id}`,
   `POST /store/carts/{id}/complete`, `POST /store/carts/{id}/customer`,
   `POST /store/customers/me/cart/attach`, shipping-methods nativos.
7. **PostgreSQL é autoridade** de validade auth/sessão e de CAS de versão.
   Redis coordena; nunca concede validade nem versão.
8. **Idempotency ≠ concurrency ≠ ownership** (D13-18). `Idempotency-Key` não
   prova ator nem substitui `If-Match`.
9. **Capability e tokens sensíveis:** hash-only na persistência; ausentes de
   logs, Sentry, analytics, exemplos OpenAPI.
10. Falha de auth/sessão/provider **não** reescreve pagamento, Order, analytics,
    e-mail de pedido ou verdade Gelato.
11. Registry TypeScript em `apps/backend/src/api-docs/` é autoridade do
    contrato HTTP. JSON gerado nunca é editado à mão.
12. Frontend permanece BLOCKED até o milestone v1.1 permitir (Phase 22 +
    closeout humano).

## Threat Model (inherited; Phase 15 must not weaken)

| Threat | Exemplo nesta phase | Resultado proibido |
|---|---|---|
| Spoofing | capability ausente, inválida, expirada ou de outro carrinho | leitura/mutação de carrinho alheio |
| Tampering | mutação stale sem `If-Match` | lost update; snapshot financeiro incompatível |
| Elevation / Bypass | rota nativa de cart/line-item ignora capability ou versão | posse ou Order fora do contrato |
| Information Disclosure | token em JSON, URL, log, exemplo ou envelope de erro | enumeração ou vazamento da capability |
| Replay | reuso indevido de `Idempotency-Key` como se fosse posse | efeito repetido sem prova de ator |

## Risks

- Dual-run sessão + capability se `active_cart_id` não for delimitado (CART-01
  substitui a prova *principal*; o destino da sessão é dúvida aberta).
- Colisão de IDs v1.0 `CART-01..04` vs v1.1 `CART-01..09`.
- ROADMAP Phase 15 incompleto — risco de inventar success criteria.
- `docs/DB_MODEL_v1.21.md` / `v1.22.md` **não** modelam entidade de guest-cart
  capability; persistência física não está decidida.
- CART-09 vs Phase 18: over-scope (implementar quote Gelato) ou under-prove
  (ignorar invalidação).
- `clearCartLineItems` (`DELETE /store/carts/{id}/line-items`) está no PRD e
  **não** no manifest Store instalado; Medusa nativo documenta add/update/delete
  por item, não um DELETE de coleção. Não inventar a rota neste CONTEXT.
- Reabilitar attach (`DENY`) pularia o contrato de merge (Phase 16).
- `13-VALIDATION.md` schema físico (bigint UNIQUE) foi supersedido pelo HCD
  13-05 (integer + partial UNIQUE). Não usar VALIDATION como autoridade física.
- `PROJECT.md` / `MILESTONES.md` podem estar stale (contadores); STATE /
  ROADMAP / REQUIREMENTS são a autoridade de progresso.
- Tratar este CONTEXT como autorização de RESEARCH/PLAN/execução.

## RESEARCH Entry Criteria

Este CONTEXT **não autoriza** RESEARCH. RESEARCH só pode começar depois de
**todos** os itens abaixo:

1. Este artefato existe e passou o gate humano aplicável.
2. Autorização humana **separada** para RESEARCH (`Phase 15 RESEARCH+: NOT AUTHORIZED`).
3. CONTEXT consumiu closures 13/14 sem reabrir `D13-*` / `D14-*`, Order-birth,
   BFF, exact-sets ou `PRESERVE_LEGACY`.
4. Conjunto de requisitos travado em `CART-01..CART-09` (v1.1); FE-CART-* é
   rastreabilidade, não requisito extra.
5. Fatos as-built registrados: sessão `active_cart_id`; active-cart
   `PRESERVE_LEGACY`; line-items DENY (`owner_phase` 15); `StoreResourceVersion`
   unwired ao Cart público; invalidação de PaymentAttempt existe; DB_MODEL sem
   tabela de guest-cart capability.
6. Dúvidas abertas listadas abaixo permanecem abertas até RESEARCH autorizado
   — não resolvidas silenciosamente aqui.
7. Não-escopo registrado: merge, checkout, Gelato quote, PaymentAttempt M1,
   frontend, providers reais, infra remota.
8. Nenhum RESEARCH contra Stripe/Gelato/Resend/Supabase/Redis de produção.
9. `workflow.auto_advance` permanece false; RESEARCH não dispara PLAN.

<decisions>
## Implementation Decisions

Decisões abaixo **reafirmam** o que REQUIREMENTS, PRD, SRS e Phases 13/14 já
fecharam. Não resolvem as dúvidas abertas.

### Identity and possession

- **D15-01 — Autoridade de IDs:** os requisitos desta phase são os `CART-01..CART-09`
  de `.planning/REQUIREMENTS.md` (v1.1). Os `CART-01..CART-04` da v1.0 Phase 3
  estão arquivados e **não** são esta phase.
- **D15-02 — Prova principal de posse:** capability CSPRNG de no mínimo 32 bytes,
  persistida somente como hash (SHA-256 no PRD §7.2). `req.session.active_cart_id`
  deixa de ser a prova principal (CART-01). O destino residual da sessão é
  dúvida aberta Q-03.
- **D15-03 — Transporte:** somente header `x-indicio-guest-cart-token`. Nunca em
  JSON, URL, query, logs, Sentry, analytics ou exemplos (CART-02; SRS-BE-CART-003;
  D13-10).
- **D15-04 — Ciclo de vida:** validar ownership, expiração e revogação; encerrar
  a capability quando o carrinho expirar, for consumido ou concluído (CART-03).
  Merge bem-sucedido consome a capability — **na Phase 16** (PRD §7.2 / MRG-05),
  não agora. TTL numérico é dúvida aberta Q-02.
- **D15-05 — Create/get:** criação/recuperação lazy e idempotente; mesma
  `Idempotency-Key` retorna o mesmo contexto ainda válido; resposta é o estado
  canônico do carrinho (CART-04; SRS-BE-CART-002). PRD §7.2 mostra `201` com
  `ETag` e o header da capability na criação. O split exato Store vs BFF do
  “emitir uma vez” é Q-10.

### Mutations and Medusa reuse

- **D15-06 — Sem segundo motor:** add/update/delete/clear reutilizam operações
  Medusa nativas **quando adequadas** (CART-05; D13-07). A biblioteca Medusa v2
  documenta `POST /store/carts/{id}/line-items`, update via
  `updateLineItemInCartWorkflow` (quantidade `0` remove o item) e
  `DELETE /store/carts/{id}/line-items/{line_id}`. Isso confirma engine nativa
  para item; **não** decide o mecanismo de clear-all (Q-05) nem autoriza
  habilitar as rotas DENY neste gate.
- **D15-07 — Quantidade:** inteiro 1–99; `0` em update = remoção; rejeitar
  negativo, decimal e `>99` (CART-06; PRD §7.3). Preço/elegibilidade vêm da
  variante; body além do schema (cart ID, preço, metadata extra) é rejeitado.
- **D15-08 — Superfície nativa a não reabrir:** create-by-id, read-by-id,
  complete, customer-attach e shipping-methods nativos permanecem DENY.
  Attach continua DENY até o contrato de merge (MRG-08).

### Concurrency

- **D15-09 — Versão server-authoritative:** incrementar versão monotônica em
  toda mudança estrutural relevante (CART-07). Consumir `StoreResourceVersion`
  já comprovado (FND-06); Redis não é autoridade de versão (D13-20; 13-05).
- **D15-10 — Contrato público de conflito:** respostas versionadas retornam
  `ETag`; mutações exigem `If-Match`; mismatch → HTTP 412,
  `code = CART_VERSION_MISMATCH`, snapshot canônico seguro quando o contrato
  permitir (CART-08; D13-21/D13-22). Sem retry destrutivo automático (D13-23).
- **D15-11 — Envelope vs DTO:** o envelope mínimo de erro já está em D13-09.
  Nomes exatos do snapshot de Cart permanecem Q-08 (D13-09 deixou para
  RESEARCH de cart).

### Invalidation and money path

- **D15-12 — Invalidação estrutural:** mudança de itens invalida quote,
  seleção de frete e PaymentAttempt incompatíveis (CART-09; PRD §7.3). Como
  provar quote/seleção **antes** da Phase 18 é Q-06. Invalidação de
  PaymentAttempt as-built em `cart-invalidation.ts` é o ponto de integração
  conhecido, não uma autorização para endurecer PaymentAttempt M1.
- **D15-13 — Order-birth intocado:** nenhuma mutação de carrinho cria Order.
  Complete nativo permanece bloqueado.

### Surface and auth carry-forward

- **D15-14 — Exact-sets da Phase 14 permanecem a autoridade atual.** Promover
  `GET/POST /store/carts/active` e line-items de `PRESERVE_LEGACY`/`DENY` para
  M1 é trabalho de **execução futura**, timing em Q-04. Este CONTEXT não altera
  o runtime.
- **D15-15 — Auth expiry preserva carrinho** (D14-08). Phase 15 não destrói
  carrinho persistido quando a sessão autentica expira ou é revogada.
- **D15-16 — Visitante vs checkout:** AUTH-02 permite compra na sessão inicial
  não verificada; CHK-01 / SRS 2.4 proíbem checkout guest. Se mutações M1 de
  line-item também servem carrinho de Customer autenticado (sem merge) é Q-07.

### Governance

- **D15-17 — Este gate é CONTEXT-only.** Não autoriza RESEARCH, PLAN, SPEC,
  execução, frontend, deploy, providers reais nem infra remota.
- **D15-18 — Dúvidas abertas não são decisões.** Q-01..Q-10 abaixo não podem
  ser fechadas por discricionariedade do agente.

### Agent Discretion

O futuro RESEARCH (somente após autorização humana separada) pode comparar
mecanismos para: persistência do hash da capability; TTL; dual-run de sessão;
timing de promoção `PRESERVE_LEGACY`→`M1_ENABLED`; mecanismo de clear-all;
prova CART-09 vs SHP; mutações autenticadas sem merge; DTO/snapshot; quais
mutações exigem `Idempotency-Key`; split Store vs BFF do header na criação.

Não há discricionariedade para relaxar hash-only, header-only, BFF-only,
Order-birth, fail-closed, `If-Match`/`412`, quantidade 1–99, anti-enumeração,
exact-sets da Phase 14, ou reabrir nativos DENY.

</decisions>

## Open Questions

Somente ambiguidades **não** fechadas nas fontes. Não são requisitos novos.
RESEARCH futuro (quando autorizado) deve respondê-las sem expandir escopo.

| ID | Question | Why it is open | Must not become |
|---|---|---|---|
| Q-01 | Onde persistir o hash da guest-cart capability? | CART-01/PRD exigem hash-only; `DB_MODEL` v1.21/v1.22 não têm essa entidade. Auth refresh capability é outra coisa. | Inventar tabela/módulo neste CONTEXT |
| Q-02 | Qual o TTL numérico da capability? | CART-03 exige expiração; nenhum número está locked. TTL 30 min de confirmação auth é outro token. | Copiar TTL de auth |
| Q-03 | O que acontece com `req.session.active_cart_id`? | CART-01 remove a prova *principal*. Compat hint, remoção ou dual-run durante `PRESERVE_LEGACY` não está escrito. | Apagar sessão no CONTEXT |
| Q-04 | Quando `GET/POST /store/carts/active` saem de `PRESERVE_LEGACY`? | `owner_phase` 15; janela de compatibilidade vs corte seco não está no ROADMAP. | Promover rotas neste gate |
| Q-05 | Como materializar `clearCartLineItems`? | PRD pede `DELETE /store/carts/{id}/line-items`; manifest tem só POST nessa path + POST/DELETE por item. Medusa nativo não documenta DELETE de coleção. | Inventar rota nativa “faltante” |
| Q-06 | Como CART-09 prova invalidação de quote/seleção sem Phase 18? | PaymentAttempt invalidation existe; quote/select não. Hook/no-op vs adiar evidência SHP não está fechado. | Implementar Gelato quote |
| Q-07 | Mutações M1 de line-item cobrem também cart autenticado? | Título da phase é Guest; AUTH-02/CHK-01 separam compra vs checkout guest. CART-01..09 não dizem se Customer autenticado reutiliza as mesmas ops sem merge. | Puxar Phase 16 |
| Q-08 | Qual o shape público do Cart DTO / snapshot de 412? | D13-09 deixou field names para RESEARCH de cart; Phase 13 não materializou DTO de Cart. | Inventar schema OpenAPI agora |
| Q-09 | Quais mutações exigem `Idempotency-Key`? | PRD trava a chave no create guest; D13-13 diz que mutações repetíveis *podem* exigir chave. CART-01..09 não listam o conjunto. | Exigir chave em tudo ou em nada |
| Q-10 | O Store emite `x-indicio-guest-cart-token` no 201, ou só o BFF? | PRD mostra o header na criação; D13-02 trava que o browser nunca o vê. Split Store↔BFF do “return once” ainda é detalhe de contrato. | Expor capability no browser |

Não tratar merge, CPF, Gelato quote ou PaymentAttempt M1 como dúvidas desta
phase — estão atribuídos a phases posteriores.

<canonical_refs>
## Canonical References

**Future RESEARCH and planning agents MUST read these before any later gate. This CONTEXT does not authorize RESEARCH, PLAN, or implementation.**

### Governance and phase state

- `.planning/PROJECT.md` — core value, constraints, Order-birth.
- `.planning/REQUIREMENTS.md` — `CART-01..CART-09`, rastreabilidade FE-CART,
  fora de escopo v1.1, inherited FND/AUTH.
- `.planning/ROADMAP.md` — goal da Phase 15 e autorização CONTEXT-only (seção
  thin: sem success criteria/refs).
- `.planning/STATE.md` — gate manual; RESEARCH+ not authorized.
- `.planning/MILESTONES.md` — backend v1.1 vs frontend bloqueado.
- `.planning/config.json` — `mode=interactive`; `auto_advance=false`;
  `auto_chain=false`; `parallelization=false`.
- `.planning/milestones/v1.1-ROADMAP.md` — sequência `13 → 22`.
- `.planning/milestones/v1.1-REQUIREMENTS.md` — snapshot do milestone.
- `.planning/milestones/v1.0-REQUIREMENTS.md` — IDs CART v1.0 arquivados (não
  reutilizar).

### Phase 13 (closed authorities)

- `.planning/phases/13-storefront-contract-foundation-surface-lockdown/13-CONTEXT.md`
  — D13-01..D13-29; BFF; fail-closed; ETag/If-Match; native reuse.
- `.planning/phases/13-storefront-contract-foundation-surface-lockdown/13-CLOSURE.md`
  — FND-01..FND-08 COMPLETE.
- `.planning/phases/13-storefront-contract-foundation-surface-lockdown/13-05-SUMMARY.md`
  — `StoreResourceVersion` comprovado; Cart público adiado para Phase 15.
- `.planning/phases/13-storefront-contract-foundation-surface-lockdown/13-01-SUMMARY.md`
  — exact 7 `PRESERVE_LEGACY`.
- `.planning/phases/13-storefront-contract-foundation-surface-lockdown/13-VALIDATION.md`
  — nota de boundary; **schema físico bigint UNIQUE está supersedido pelo HCD 13-05**.

### Phase 14 (closed authorities)

- `.planning/phases/14-customer-auth-verification/14-CONTEXT.md` — D14-*;
  D14-08 preserva cart.
- `.planning/phases/14-customer-auth-verification/14-CLOSURE.md` — AUTH-01..09
  COMPLETE; exact-sets; zero-Order.
- `.planning/phases/14-customer-auth-verification/14-21-SUMMARY.md` — evidência
  final aceita.

### Product / data / FE traceability

- `docs/PRD_Backend_v1.1.md` §7.2 guest capability, §7.3 mutações, §7.4 merge
  (Phase 16).
- `docs/PRD_frontend_v1.1.md` — BFF injeta `x-indicio-guest-cart-token` / `If-Match`.
- `docs/SRS_v1.5.md` — SRS-BE-CART-001..008; SRS 2.4 limites do visitante;
  SRS 3.1–3.2 BFF.
- `docs/FRONTEND_CONTRACT_TRACEABILITY.md` §5 cart; FE-CART-001..008.
- `docs/DB_MODEL_v1.21.md` — pointer de planning; **sem entidade guest-cart
  capability**.
- `docs/DB_MODEL_v1.22.md` — presente no disco; **também sem entidade
  guest-cart capability**.

### Absent (flag, do not invent)

- `.planning/DECISIONS-INDEX.md` — não existe; usar D13-* / D14-* / D15-*.
- `.planning/codebase/*.md` — maps ausentes; usar paths em Existing Code Insights.
- Phase 15 RESEARCH.md / PLAN.md — não existem e não estão autorizados.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- Active cart v1.0 (sessão): `apps/backend/src/api/store/carts/active/route.ts`,
  `apps/backend/src/modules/checkout/active-cart.ts`,
  `apps/backend/src/api/store/carts/serializers.ts`.
- Concurrency primitive: `apps/backend/src/modules/store-resource-version/`
  (model, service, migration, postgres spec). Consumir; não reinventar CAS.
- CART-09 as-built (pagamento): `apps/backend/src/modules/payment-attempt/cart-invalidation.ts`.
- Surface: `apps/backend/src/api/store-surface/manifest.ts`,
  `apps/backend/src/api/store-surface/guard.ts`,
  `apps/backend/src/api/middlewares.ts`.
- BFF caller: `apps/backend/src/modules/customer-auth/bff-service-auth.ts`.
- Idempotency: `apps/backend/src/modules/store-idempotency/`.
- Registry: `apps/backend/src/api-docs/operations/store/carts.ts`.
- Attach DENY (Phase 16 successor): `apps/backend/src/api/store/customers/me/cart/attach/route.ts`.
- Complete DENY (Order-birth): `apps/backend/src/api/store/carts/[id]/complete/route.ts`.

### Established Patterns

- Fail-closed: operação não classificada ou sem prova = DENY.
- `PRESERVE_LEGACY` passa runtime v1.0; não publica contrato M1.
- PostgreSQL é verdade de unicidade/versão; Redis não decide.
- Erros públicos: vocabulário fechado; detalhes internos sanitizados.
- Hash-only para material sensível; exemplos OpenAPI sintéticos.

### Integration Points

- Manifest `owner_phase` 15 ainda DENY/PRESERVE_LEGACY:
  `POST /store/carts/{id}/line-items`,
  `POST /store/carts/{id}/line-items/{line_id}`,
  `DELETE /store/carts/{id}/line-items/{line_id}`,
  `GET /store/carts/active`,
  `POST /store/carts/active`.
- Store M1_ENABLED atual (não dropar): 6 rotas Customer da Phase 14.
- Suites as-built relevantes (evidência atual, não plano de testes desta phase):
  `apps/backend/integration-tests/http/cart-checkout-store.spec.ts`,
  `apps/backend/src/modules/checkout/__tests__/active-cart.unit.spec.ts`,
  `apps/backend/src/api-docs/__tests__/store-contract.unit.spec.ts`.
- Medusa v2 nativo (documentação atual): add line item, update line item
  (qty 0 remove), delete line item. Clear-all de coleção **não** está no
  contrato nativo documentado — ver Q-05.

</code_context>

<specifics>
## Specific Ideas

Contrato de posse alvo (já no PRD §7.2; não implementar agora):

```text
201 Created
ETag: "<cart-version>"
x-indicio-guest-cart-token: "<opaque-capability>"
```

Contrato de conflito alvo (já em D13-22 / CART-08):

```text
HTTP 412
code = CART_VERSION_MISMATCH
(+ safe canonical cart snapshot when the contract allows)
```

Contrato de quantidade (PRD §7.3 / CART-06):

```text
qty ∈ {1..99} integer
update qty 0 = remove
reject negative | decimal | >99
```

Store closure counts a preservar como baseline (Phase 14):

```text
runtime total: 63
native identity: 51
local-only: 12
DENY: 50
PRESERVE_LEGACY: 7
M1_ENABLED: 6
```

Nenhuma referência “quero que funcione como X” nova foi introduzida neste
gate além dos documentos canônicos acima.

</specifics>

<deferred>
## Deferred Ideas

Discussion stayed within phase scope. The following belong to later phases
and must not be pulled into Phase 15:

- Cart merge & review, capability consumption on merge commit — Phase 16
  (`MRG-01..MRG-08`, PRD §7.4).
- Authenticated BR checkout, CPF, consent; guest checkout remains out of
  Frontend M1 — Phase 17.
- Gelato quote/select — Phase 18.
- PaymentAttempt M1 hardening / guest payment removal — Phase 19.
- Async confirmation, order summary, catalog handoff, contract kit —
  Phases 20–22.
- Frontend / Next.js implementation.

RESEARCH, PLAN, SPEC/SDD, implementation, tests, migrations, providers,
deploy e auto-chain permanecem bloqueados até autorização humana explícita
e **separada**.

</deferred>

## Documentary Gaps (flag, do not fill by invention)

1. ROADMAP Phase 15 sem success criteria, requirement IDs, deliverables,
   canonical refs ou out-of-scope.
2. `.planning/DECISIONS-INDEX.md` ausente.
3. `.planning/codebase/*.md` ausente.
4. DB_MODEL sem entidade de guest-cart capability.
5. `clearCartLineItems` no PRD ausente do manifest instalado.
6. CART-09 menciona quote/seleção ainda inexistentes.
7. `PROJECT.md` / `MILESTONES.md` podem estar stale vs STATE/REQUIREMENTS.
8. PRD Frontend / SRS “Aprovado — pendente”: AUTH COMPLETE não entrega FE-CART.

---

*Phase: 15-guest-cart-capability-concurrency*
*Context gathered: 2026-08-19*
*Gate: CONTEXT executed — awaiting human review*
*RESEARCH / PLAN / EXECUTION: NOT AUTHORIZED*
