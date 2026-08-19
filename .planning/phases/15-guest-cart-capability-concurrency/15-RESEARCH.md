# Phase 15: Guest Cart Capability & Concurrency — Research

**Pesquisado em:** 2026-08-19

**Domínio:** posse do carrinho convidado por capability opaca, mutações concorrentes
seguras (`ETag` / `If-Match` / 412) e reuso do motor Medusa de line-items

**Compatibilidade-alvo:** artefatos npm Medusa `2.16.0` efetivamente instalados,
Node.js `22.x`, PostgreSQL como autoridade de CAS/validade e Redis somente como
coordenação

**Confiança geral:** HIGH para o as-built, lockfile e `node_modules/@medusajs/*@2.16.0`;
HIGH para decisões locked em `15-CONTEXT.md` / REQUIREMENTS / PRD / SRS / Phases 13–14;
MEDIUM para documentação Context7 `/websites/medusajs` (sem pin 2.16); INFERENCE onde
este documento recomenda desenho futuro. [VERIFIED: Subagents A/B/C; `apps/backend/package.json`]

**Gate:** RESEARCH only. Não autoriza PLAN, execução, frontend, deploy, providers reais
nem infra remota.

**Subagents:**
- A as-built audit — Composer 2.5 — `PHASE 15 RESEARCH AS-BUILT AUDIT — PASS`
- B security/concurrency — Grok 4.6 — `PHASE 15 SECURITY RESEARCH — PASS`
- C Medusa/runtime — Composer 2.5 + Context7 — `PHASE 15 MEDUSA RESEARCH — PASS`

<user_constraints>
## User Constraints (from CONTEXT.md)

> Conteúdo abaixo reafirma `15-CONTEXT.md`; D15-01..D15-18 e invariantes
> transversais são imutáveis. Q-01..Q-11 eram dúvidas abertas; este RESEARCH
> recomenda respostas sem promover rotas nem escrever DDL. [VERIFIED:
> `.planning/phases/15-guest-cart-capability-concurrency/15-CONTEXT.md`]

### Locked Decisions

- **D15-01 — Autoridade de IDs:** requisitos desta phase são `CART-01..CART-09`
  v1.1. Os `CART-01..CART-04` da v1.0 Phase 3 estão arquivados.
- **D15-02 — Prova principal de posse:** capability CSPRNG ≥ 32 bytes, persistida
  somente como hash (SHA-256 no PRD §7.2). `req.session.active_cart_id` deixa de
  ser a prova principal.
- **D15-03 — Transporte:** somente header `x-indicio-guest-cart-token`. Nunca em
  JSON, URL, query, logs, Sentry, analytics ou exemplos.
- **D15-04 — Ciclo de vida:** validar ownership, expiração e revogação; encerrar
  quando o carrinho expirar, for consumido ou concluído. Merge consome na Phase 16.
- **D15-05 — Create/get:** lazy e idempotente, estado canônico. Mesma
  `Idempotency-Key` deve poder retornar o mesmo contexto ainda válido. Replay da
  capability bruta após 201 perdido = Q-11.
- **D15-06 — Sem segundo motor:** add/update/delete/clear reutilizam operações
  Medusa nativas **quando adequadas**.
- **D15-07 — Quantidade:** inteiro 1–99; `0` em update = remoção; rejeitar
  negativo, decimal e `>99`.
- **D15-08 — Superfície nativa a não reabrir:** create-by-id, read-by-id,
  complete, customer-attach e shipping-methods nativos permanecem DENY.
- **D15-09 — Versão server-authoritative:** `StoreResourceVersion` já comprovado;
  Redis não é autoridade de versão.
- **D15-10 — Contrato público de conflito:** `ETag`; `If-Match` nas mutações;
  `412 CART_VERSION_MISMATCH` + snapshot canônico seguro. Sem retry destrutivo.
- **D15-11 — Envelope vs DTO:** envelope mínimo D13-09; nomes do snapshot = Q-08.
- **D15-12 — Invalidação estrutural:** itens invalidam quote, seleção e
  PaymentAttempt incompatíveis. Quote/select = Q-06. Não endurecer PaymentAttempt M1.
- **D15-13 — Order-birth intocado.** Complete nativo permanece bloqueado.
- **D15-14 — Exact-sets da Phase 14 permanecem a autoridade atual** até promoção
  futura. `PRESERVE_LEGACY` ≠ `M1_ENABLED`.
- **D15-15 — Auth expiry preserva carrinho** (D14-08).
- **D15-16 — Visitante vs checkout:** AUTH-02 permite compra na sessão inicial;
  CHK-01 / SRS 2.4 proíbem checkout guest.
- **D15-17 — CONTEXT-only no gate anterior.** Este RESEARCH não autoriza PLAN.
- **D15-18 — Q-01..Q-11 não podem ser fechadas por discricionariedade do agente.**
  Este artefato recomenda; lock humano do RESEARCH precede PLAN.

### Invariants that RESEARCH must not weaken

- Order nasce somente no webhook Stripe canônico.
- BFF-only; browser-direct Medusa proibido.
- Capability CSPRNG ≥ 32 bytes; persistência hash-only.
- Capability apenas em `x-indicio-guest-cart-token`.
- `Idempotency-Key` não prova ownership.
- PostgreSQL autoridade de CAS/validade.
- `ETag` / `If-Match` / 412.
- qty 1–99; update 0 = remove.
- `PRESERVE_LEGACY` ≠ `M1_ENABLED`.
- Exact-sets Auth/Store da Phase 14 não podem regredir.
- Não puxar merge, checkout, Gelato quote ou PaymentAttempt M1 das Phases 16–19.

### Q-11 forbidden solutions

Não aceitar solução que persista capability plaintext, exponha capability ao
browser, transforme `Idempotency-Key` em capability, ou enfraqueça hash-only.
</user_constraints>

## Research Scope

Este estudo cobre somente `CART-01..CART-09` e responde `Q-01..Q-11`. Não
implementa endpoints, modelos, migrations, testes, OpenAPI writer, configuração,
provider, frontend ou deploy. [VERIFIED: pedido Phase 15 RESEARCH-only e
`15-CONTEXT.md`]

Ordem de autoridade:

1. Decisões D15 / D13 / D14 imutáveis e REQUIREMENTS v1.1.
2. Artefato npm Medusa `2.16.0` instalado (`node_modules`).
3. Código as-built do repositório.
4. PRD Backend/Frontend, SRS, DB_MODEL (ausência de entidade guest-cart).
5. Context7 `/websites/medusajs` — orientação, nunca autoridade sobre o instalado.
6. Inferência explicitamente rotulada.

### Phase Requirements

| ID | Descrição normativa | Apoio desta pesquisa |
|---|---|---|
| CART-01 | Capability CSPRNG ≥ 32 bytes; persistir somente hash; substitui sessão como prova principal. | Q-01, Q-03, lifecycle |
| CART-02 | Transporte só em `x-indicio-guest-cart-token`. | Q-10 |
| CART-03 | Ownership, expiração, revogação; encerrar em expire/consumed/complete. | Q-02, lifecycle |
| CART-04 | Create/get lazy idempotente; estado canônico. | Q-09, Q-11 |
| CART-05 | Add/update/delete/clear reusando Medusa quando adequado. | Q-05 |
| CART-06 | Qty inteiro 1–99; 0 = remove; rejeitar negativo/decimal/>99. | Medusa validators vs wrapper |
| CART-07 | Versão monotônica em mudança estrutural. | `StoreResourceVersion` |
| CART-08 | `ETag` / `If-Match` / `412 CART_VERSION_MISMATCH` + snapshot. | Q-08 |
| CART-09 | Invalidar quote/seleção/PaymentAttempt incompatíveis; anti-bypass nativo. | Q-06 |

## Reconciliação Medusa 2.16.0

O artefato npm instalado é a autoridade as-built. `AGENTS.md` / STACK ainda
citam **2.15.x** — drift documental, não runtime. [VERIFIED: `apps/backend/package.json`,
`package-lock.json`, `STORE_SURFACE_MEDUSA_VERSION` em `manifest.ts`]

| Pacote | Declared / lock / node_modules |
|---|---|
| `@medusajs/medusa` | `2.16.0` |
| `@medusajs/framework` | `2.16.0` |
| `@medusajs/core-flows` | `2.16.0` (transitivo) |
| `@medusajs/cli` | `2.16.0` |
| Node engines | `>=22 <23` |

Context7 `/websites/medusajs` descreve corretamente add/update/delete **por item**
e `quantity === 0` remove no `updateLineItemInCartWorkflow`. **Não** documenta
`DELETE /store/carts/{id}/line-items` (clear-all) nem teto qty 1–99. Sempre
diff contra `node_modules` antes de PLAN. [EXTERNAL-DOC: Context7 `/websites/medusajs`]
[VERIFIED: `node_modules/@medusajs/medusa/dist/api/store/carts/middlewares.js`]

## Executive Findings

1. **Posse guest hoje = sessão.** `req.session.active_cart_id` é setado no create,
   lido em cart/payment/attach, **nunca limpo**. Não existe
   `x-indicio-guest-cart-token` no código nem no OpenAPI. [VERIFIED: `active/route.ts`]

2. **Não há entidade guest-cart capability.** DB_MODEL v1.21/v1.22 e migrations
   as-built: **ABSENT**. Auth refresh (nonce+HKDF) e tracking (CSPRNG+hash) são
   análogos, não reutilizáveis. [VERIFIED: DB_MODEL; grep]

3. **`StoreResourceVersion` está pronto e unwired** ao Cart público — exatamente
   o adiamento da Phase 13. [VERIFIED: módulo + 13-05-SUMMARY]

4. **Line-items nativos existem no Medusa 2.16.0 e estão DENY.** Workflows
   `addToCart` / `updateLineItemInCart` / `deleteLineItems` (multi-id) são o
   motor a reusar. Rota HTTP clear-all **não existe**. [VERIFIED: node_modules]

5. **Validators nativos não implementam CART-06.** Add: `quantity > 0` sem
   `.int()` nem teto 99. Update: `>= 0` e qty 0 remove no workflow. Wrapper
   local obrigatório. [VERIFIED: `validators.js`]

6. **Q-11 não pode reemitir o plaintext a partir do hash.** Fato as-built /
   crypto: SHA-256 não é invertível; `store-idempotency` não persiste secrets.
   [VERIFIED: `store-idempotency/service.ts`; LOCKED: CART-01 hash-only]
   Recomendação (não é D15 lock): distinguir **duas** perdas.
   **A — Store→BFF recebido; BFF→browser falhou.** O BFF já possui a
   capability. Se o cookie HttpOnly foi gravado **antes** da resposta
   browser-facing, a posse PODE sobreviver; retry do browser PODE recuperar
   via cookie + GET com `x-indicio-guest-cart-token`.
   **B — Store commitou o create; a resposta Store→BFF foi perdida ANTES de
   o BFF receber a capability.** O BFF **não** possui o secret. Hash-only
   impede reconstrução. Replay da **mesma** `Idempotency-Key` devolve só
   **contexto seguro** (cart + ETag); **não** recupera nem reemite a
   capability. `Idempotency-Key` **não** é credencial de recuperação. A
   capability perdida permanece irrecuperável; o carrinho fica
   órfão/inacessível; o BFF inicia novo create com **nova**
   `Idempotency-Key`; o órfão expira pelo lifecycle/TTL (CART-03).
   Retry in-process enquanto o BFF ainda tem o 201 em memória **não** é
   perda Store→BFF — é resposta já recebida. Rejeitados: persistência
   plaintext, token cifrado recuperável, HKDF/derivação reversível,
   rotation-on-replay como default, `Idempotency-Key` como capability.
   [RECOMMENDATION: Q-11 Option A]

7. **Promoção M1 na execução desta phase** (não neste RESEARCH): active +
   3 line-items + **nova** `DELETE` collection. Contagens projetadas: total 64,
   DENY 47, PRESERVE_LEGACY 5, M1_ENABLED 12. As 6 rotas Auth da Phase 14
   permanecem. [RECOMMENDATION]

## Architectural Responsibility Map

| Concern | Owner | Must not |
|---|---|---|
| Prova de posse guest | Módulo dedicado hash-only + header | Sessão Medusa; `Idempotency-Key`; prova Customer Phase 14 |
| Prova de posse Customer | Guard BFF + autoridade de acesso Customer aprovada na Phase 14 (`customerAuthAccessGuard` / estado PostgreSQL) + principal Customer/identity estável do contexto autorizado (Q-07) | Native `authenticate("customer", ["session", "bearer"])`; JWT cru; hash do JWT; session id Medusa; guest capability |
| Concorrência | `StoreResourceVersion` + `If-Match` | Redis como autoridade; retry destrutivo |
| Idempotência | `store-idempotency` existente | Persistência de secret; transferência de ownership; `Idempotency-Key` como posse |
| Mutação de itens | Workflows Medusa atrás de rotas **locais** | Reabilitar HTTP nativo DENY |
| Invalidação pagamento | `cart-invalidation.ts` as-built | PaymentAttempt M1 (Phase 19) |
| Invalidação quote/select | Hook no-op Phase 15 | Implementar Gelato (Phase 18) |
| Emissão da capability | Store → BFF header no 201 | Encaminhar ao browser |
| Recuperação pós-201 (perda A) | Cookie BFF HttpOnly se o BFF já detém o secret e gravou o cookie antes de responder | Reconstruir token a partir do hash; usar `Idempotency-Key` como credencial de recuperação; tratar retry com 201 em memória como perda Store→BFF |
| Recuperação pós-commit (perda B) | Replay só de contexto seguro; novo create com nova `Idempotency-Key`; órfão segue TTL | Reemitir/recuperar capability; rotation-on-replay como default |

## Project Constraints (from AGENTS.md / CONTEXT)

- Tech stack Medusa v2 + TypeScript; módulos isolados; links em vez de FK
  cross-module.
- PostgreSQL autoridade; Redis coordena.
- Order só no webhook Stripe canônico.
- Tokens/capabilities: hash-only; nunca em logs.
- Mercado BR/BRL. Frontend BLOCKED.

Drift: AGENTS.md ainda lista Medusa 2.15.x; as-built é 2.16.0.

## As-Built Surface Inventory

### Store M1_ENABLED exact-set (6) — Phase 14, não silenciar

`GET /store/customers/me`, `POST /store/customers/me/verify`,
`POST /store/customers/verify/resend`, `POST /store/customers/verify`,
`GET /store/customers/me/verify/status`, `POST /store/customers/me/password`.
[VERIFIED: `manifest.ts`, 14-CLOSURE]

### PRESERVE_LEGACY (7)

| Método | Path | owner_phase |
|---|---|---|
| GET | `/store/products` | 21 |
| GET | `/store/products/{id}` | 21 |
| GET | `/store/carts/active` | **15** |
| POST | `/store/carts/active` | **15** |
| POST | `/store/carts/{id}/payment-attempts/card` | 19 |
| POST | `/store/carts/{id}/payment-attempts/pix` | OUTSIDE_FRONTEND_M1 |
| POST | `/store/tracking/lookup` | — |

### owner_phase 15 atual

| Método | Path | runtime_policy |
|---|---|---|
| POST | `/store/carts/{id}/line-items` | DENY |
| POST | `/store/carts/{id}/line-items/{line_id}` | DENY |
| DELETE | `/store/carts/{id}/line-items/{line_id}` | DENY |
| GET | `/store/carts/active` | PRESERVE_LEGACY |
| POST | `/store/carts/active` | PRESERVE_LEGACY |

Handlers locais de line-item: **ABSENT**. Guard DENY impede o handler Medusa.
[VERIFIED: glob + `guard.ts`]

### DENY que devem permanecer DENY (não reabrir)

`POST /store/carts`, `GET/POST /store/carts/{id}`,
`POST /store/carts/{id}/complete`, `POST /store/carts/{id}/customer`,
`POST /store/customers/me/cart/attach`, shipping-methods / shipping-options
nativos. [LOCKED: D15-08]

Baseline counts (não regressar as 6 M1 auth):

```text
runtime total: 63
native identity: 51
local-only: 12
DENY: 50
PRESERVE_LEGACY: 7
M1_ENABLED: 6
```

## Reusable Primitives

### StoreResourceVersion (CART-07/08)

Campos: `resource_type`, `resource_id`, `version` integer default 1; UNIQUE
parcial `(resource_type, resource_id) WHERE deleted_at IS NULL`; CHECK
`version > 0`. API: `initializeOrLoadVersion`, `compareAndIncrementVersion`,
`mutateWithVersionCas`. Writes MedusaService gerados fail-closed. Exige
transação PostgreSQL. **Zero imports** fora do módulo. [VERIFIED: service +
migration HCD 13-05]

**Consumo recomendado:** `resource_type = "cart"`, `resource_id = cart.id`.
`ETag: "<n>"` quoted. GET não incrementa. Mutação estrutural incrementa.

### store-idempotency (CART-04 / Q-09 / Q-11)

Escopo: `operation` + `actor_scope_hash` + `resource_scope_hash` +
`idempotency_key_hash` (HMAC-SHA-256 + pepper; raw key nunca persistida).
Estados: `claimed` | `in_progress` | `replay` | `conflict`. Replay **não**
transfere ownership. Persiste metadata allowlist, **não** body JSON nem
secrets. Chave `capability` é **proibida** no metadata. **Não wired** em rotas
cart. [VERIFIED: `store-idempotency/service.ts`]

### Hash-only analogs

| Analog | Padrão | Usar para guest cart? |
|---|---|---|
| Auth refresh/verify/reset | nonce persistido + HKDF/HMAC rederivável | **Não** (Q-01: outra coisa) |
| Tracking access token | CSPRNG mint + persistir `token_hash`; plaintext só no mint | **Sim, como analogia de mint** — módulo separado |
| store-idempotency | hash da key; replay de metadata | Replay de **contexto**, nunca do secret |

[VERIFIED: `customer-auth/security/capabilities.ts`;
`tracking-access-token/service.ts`]

### cart-invalidation (CART-09 pagamento)

`resolvePaymentAttemptCartFingerprint`, `invalidateActivePaymentAttemptForCartChange`,
`reconcileStalePaymentAttemptsForCartFingerprint`. Integrado em card/pix.
Quote/select: **ABSENT**. [VERIFIED: `cart-invalidation.ts`]

### PublicStoreCartPreOrder

DTO as-built: id, email, totals BRL, items, `shipping_address` com
`masked_federal_tax_id`, `checkout_data_complete`. Sem `version`. Sem capability.
Middleware sanitiza `{ cart }`. [VERIFIED: `serializers.ts`]

### BFF caller

`CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS` — 12 ops auth/customer, **zero cart**.
Lista fechada, sem prefix-match. Cart active usa `authenticate(..., allowUnauthenticated: true)`
sem BFF guard. [VERIFIED: `bff-service-auth.ts`; `middlewares.ts`]

**Restrição:** emitir `x-indicio-guest-cart-token` numa rota alcançável só com
publishable key vazaria a capability. Promoção M1 do create **exige** credencial
BFF **antes** da primeira emissão.

## Native Medusa 2.16.0 line-items

[VERIFIED: `node_modules/@medusajs/medusa/dist/api/store/carts/middlewares.js`,
`validators.js`, `@medusajs/core-flows` workflows]

| HTTP nativo | Validator | Workflow |
|---|---|---|
| POST `.../line-items` | `quantity > 0` | `addToCartWorkflow` |
| POST `.../line-items/{line_id}` | `quantity >= 0` | `updateLineItemInCartWorkflow` (qty 0 → delete) |
| DELETE `.../line-items/{line_id}` | — | `deleteLineItemsWorkflow({ ids: [line_id] })` |
| DELETE `.../line-items` | — | **ABSENT** |

`deleteLineItemsWorkflow` aceita `ids: string[]` — mecanismo programático de
clear-all existe; rota HTTP não.

Padrão Medusa v2: handlers nativos são finos (workflow + refetch). Custom API
routes que executam os mesmos workflows são o padrão oficial e já usado em
`active/route.ts`. [EXTERNAL-DOC: Context7] Reabilitar HTTP nativo sem
capability/`If-Match`/idempotency/DTO viola D13-07.

## Q-01 — Persistência do hash da guest capability

**Recomendação:** módulo Medusa dedicado (nome a PLAN, p.ex. `guest-cart-capability`)
com tabela PostgreSQL hash-only. Não reutilizar `customer-auth`,
`store-idempotency`, `cart.metadata` nem tracking pepper-HMAC.

Campos lógicos mínimos [RECOMMENDATION]:

- `id`
- vínculo a Cart via **module link** (não FK cross-module)
- `token_hash` SHA-256 hex, UNIQUE
- `status` (`active` | `expired` | `revoked` | `consumed`)
- `expires_at`, `consumed_at?`, `revoked_at?`
- timestamps

Não persistir: plaintext, nonce, `Idempotency-Key` raw, cookie, JWT.

Algoritmo: SHA-256 do token emitido, como PRD §7.2 — **não** HMAC-pepper de
tracking (outro domínio) e **não** HKDF de auth. 32 bytes CSPRNG tornam
brute-force do hash inviável. Compare com `timingSafeEqual`; dummy hash em miss
(padrão tracking). Cardinalidade: no máximo uma capability `active` por
carrinho guest.

PostgreSQL é autoridade; Redis não concede validade. [LOCKED: invariante 7]

**Classificação:** RECOMMENDATION (schema físico). Não é DDL neste gate.

## Q-02 — TTL

**Não copiar** 30 min de verificação auth / confirmação de pagamento / cotação.
[LOCKED: D15-04; CONTEXT Q-02 must-not; PRD §11.4 distingue “tokens de
confirmação | TTL 30 min” vs “capability de carrinho | hash até consumo,
expiração ou conclusão”] O valor numérico do TTL da capability **não** está
locked.

CART-03 exige expiração; **nenhum número está locked**.

**Recomendação (não lock): 7 dias, rolling no uso válido (GET/mutação), teto
absoluto opcional 30 dias.**

Rationale: jornada de browsing, não desafio de e-mail; alinha inatividade
frontend, cookie rolling, purge de CPF de carrinho abandonado (7d) e inactivity
de refresh (7d). Cookie BFF `Max-Age` deve ser **≤** TTL da capability.

PLAN/humano podem ajustar (ex. 14d) sem copiar 30 min.

## Q-03 — Destino de `req.session.active_cart_id`

**Recomendação: dual-run delimitado, não corte seco.** Não puxar Phase 19.

| Superfície | Prova |
|---|---|
| GET/mutações M1 de cart guest | **Só** capability. Sessão insuficiente e **não obrigatória**. |
| Payment guest `PRESERVE_LEGACY` (card/pix) | Continua sessão até Phase 19. Create M1 **pode** gravar `active_cart_id` como *hint* se a sessão Medusa existir — nunca como posse M1. |
| Attach nativo | Permanece DENY (Phase 16). |

Corte seco nesta phase quebraria `assertCartAccess` / payment eligibility, que
ainda comparam `sessionActiveCartId === cart.id`. [VERIFIED: `eligibility.ts`]
D14-08: expiry auth não destrói o carrinho persistido.

Storefront alvo não usa `connect.sid`. [LOCKED: PRD Frontend §13.2] No BFF
server-to-server a sessão Medusa pode nem existir — por isso M1 cart não pode
exigir sessão.

## Q-04 — Quando `GET/POST /store/carts/active` saem de `PRESERVE_LEGACY`

**Recomendação:** promover **na execução da Phase 15**, no mesmo corte que
capability + ETag + line-items M1. Não manter active em `PRESERVE_LEGACY` com
mutações já M1.

Pré-condição de segurança: credencial BFF na lista protegida **antes** da
primeira emissão do header. Dual-run aceitável só no eixo sessão×capability
para payment legacy (Q-03), não no eixo de classificação da rota active.

Este RESEARCH **não** promove rotas.

## Q-05 — clearCartLineItems

PRD pede `DELETE /store/carts/{id}/line-items`. Manifest e Medusa 2.16.0 têm
só POST nessa path + POST/DELETE por item. [VERIFIED]

| Opção | Veredito |
|---|---|
| Rota **local** M1: listar items + `deleteLineItemsWorkflow({ cart_id, ids })` | **Recomendada** — reusa o motor (CART-05) |
| DELETE sequencial por item | Fallback — pior atomicidade |
| Inventar rota nativa “faltante” no pacote Medusa | **Proibido** |

Rota local: ownership (guest capability **ou** contexto Customer autorizado
Phase 14: guard BFF + `customerAuthAccessGuard`) → `If-Match` → query items →
se vazio 200 idempotente → senão uma invocação do workflow → bump versão →
invalidação estrutural → DTO + `ETag`. Mesmas operações; provas de posse
distintas.

**Impacto exact-set:** adicionar a operação sobe `COUNT_TOTAL` 63 → 64. Aceitar
+1 local em vez de sacrificar o contrato PRD. Atualizar
`validateStoreSurfaceManifest` na **execução**, sem remover as 6 auth.

## Q-06 — CART-09 vs Phase 18

Não implementar Gelato quote. Não ignorar invalidação.

**Três camadas:**

1. **PaymentAttempt real** — chamar `cart-invalidation.ts` em toda mutação
   estrutural M1 (já existe).
2. **Quote/select** — interface interna no-op (`invalidateShippingQuote` /
   `invalidateShippingSelection`) com testes de invocação em toda rota M1 de
   line-item. Phase 18 substitui o no-op sem mudar o contrato HTTP cart.
3. **Anti-bypass** — handlers HTTP nativos permanecem DENY; só rotas locais
   passam o guard.

## Q-07 — Mutações M1 também para cart autenticado?

**Recomendação: sim**, as mesmas rotas de line-item servem o cart do Customer
**sem merge** (Phase 16). Título “Guest” é o foco da capability, não exclusão
do ator autenticado.

`GET/POST /store/carts/active` já bifurca customer (`customer_id`) vs guest
(sessão). [VERIFIED: `active-cart.ts`] Isso é **PRESERVE_LEGACY**, **não** a
autoridade M1 de Customer.

| Ator | Prova M1 |
|---|---|
| Guest | `x-indicio-guest-cart-token` (persistência hash-only) |
| Customer | Guard BFF + autoridade de acesso Customer aprovada na Phase 14 (`customerAuthAccessGuard` / estado de acesso em PostgreSQL); principal Customer/identity estável derivado desse contexto autorizado. **Não** native Medusa `authenticate("customer", ["session", "bearer"])`, JWT cru, hash do JWT, session id Medusa, nem guest capability. |

Guest capability não autoriza cart de Customer; a prova Customer não
substitui guest capability. `{id}` nas rotas de line-item deve ser o cart
ativo daquele ator. CHK-01 / SRS 2.4 continuam a proibir checkout guest.
Nenhuma mudança no contrato JWT da Phase 14. Nenhum `actor_type` /
`actor_id` Medusa novo.

## Q-08 — Cart DTO / snapshot 412

**Recomendação:** reutilizar `PublicStoreCartPreOrder` como único shape de
resposta e de snapshot 412. **Não** incluir capability, `version` no body,
payment/order internals, metadata bruta.

Versão: só header `ETag: "<n>"` / `If-Match`.

412 sintético:

```text
HTTP 412
ETag: "<current-version>"
code = CART_VERSION_MISMATCH
retryable = false
cart = PublicStoreCartPreOrder (snapshot atual)
```

Evoluir `StoreErrorResponse.cart` de placeholder para `$ref PublicStoreCartPreOrder`
na execução. Envelope mínimo D13-09 permanece. `GuestCartEnvelope.guestCartToken`
do PRD Frontend é envelope de **cookie BFF**, não DTO Store/JSON.

## Q-09 — Quais mutações exigem `Idempotency-Key`

`Idempotency-Key` ≠ ownership ≠ `If-Match`. [LOCKED: D13-18]

| Operação | Key? |
|---|---|
| `POST /store/carts/active` | **Obrigatória** (PRD §7.2 / SRS-BE-CART-002) |
| `GET /store/carts/active` | **Não** (read; FE-CART-001: no cart on GET) |
| `POST .../line-items` (add) | **Obrigatória** |
| `POST .../line-items/{id}` (update) | **Obrigatória** |
| `DELETE .../line-items/{id}` | **Obrigatória** |
| `DELETE .../line-items` (clear) | **Obrigatória** se a rota M1 existir |

Actor scope no create (ainda sem capability): identidade BFF hashed — **não** a
própria Idempotency-Key como ator. Após mint, actor scope das mutações
[RECOMMENDATION]:

- **Guest:** identidade estável derivada da guest capability / hash da
  capability, **sem persistir plaintext**.
- **Customer:** identificador estável de Customer/identity proveniente do
  contexto autorizado da Phase 14 (`customerId` / principal de identity após
  guard BFF + `customerAuthAccessGuard`).
- **Não:** JWT cru, hash do JWT, nem session id nativo Medusa.

Motivo: refresh/rotação de credencial **não** pode alterar o actor scope de
idempotência quando o Customer/identity continua o mesmo. Guest e Customer
podem reutilizar as mesmas operações M1; as provas de posse permanecem
distintas. Nenhuma mudança no JWT da Phase 14; nenhum `actor_type` /
`actor_id` Medusa novo.

A interação `Idempotency-Key × If-Match` em retries de mutação é decisão
obrigatória do PLAN (ver Must Be Decided in PLAN). Não desenhada aqui.

## Q-10 — Store vs BFF na emissão da capability

**Recomendação: o Store emite `x-indicio-guest-cart-token` no `201` (e só aí);
o BFF nunca encaminha ao browser.**

1. Store → BFF: header no 201; ausente do body. GET subsequente **não** reemite
   (emit-once). No OpenAPI, o parâmetro `x-indicio-guest-cart-token` deve
   permanecer anotado `x-sensitive: true` (extensão de schema, **não** um
   segundo header HTTP runtime). [LOCKED: CART-02; PRD Backend §7.2]
2. BFF → browser: JSON sem token; cookie `indicio_cart_id`
   HttpOnly/Secure/SameSite=Lax/host-only. [LOCKED: PRD Backend §4.1 / §7.2;
   PRD Frontend §7.7 / §13.1; SRS 3.1–3.2 / 6.2]
   **Fence:** o cookie é contrato do BFF/storefront futuro. A execução Phase 15
   não implementa Next.js nem seta cookie no browser. [LOCKED: frontend BLOCKED]
3. BFF → Store: injeta header a partir do cookie; gera `Idempotency-Key`;
   propaga `If-Match`.

Estender `CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS` (ou lista irmã de cart) na
execução, lista fechada.

## Q-11 — Replay idempotente após resposta perdida + hash-only

Problema: CART-04 exige o mesmo contexto ainda válido; CART-01 exige CSPRNG
emitida uma vez e persistência só SHA-256. Hash não é invertível.

**“Contexto” = `cart_id` + DTO canônico + `ETag`. Não é o secret.**

### Option A — ACCEPT (canônica)

Recomendação de RESEARCH, **não** D15 lock. Distinguir duas perdas. Não
adotar persistência plaintext, token cifrado recuperável, HKDF/derivação
reversível, rotation-on-replay como default, nem `Idempotency-Key` como
capability/posse.

#### A) Store → BFF recebido com sucesso; BFF → browser falhou

O BFF **já possui** a capability. Se o cookie HttpOnly foi gravado **antes**
da resposta browser-facing, a posse PODE sobreviver. Retry do browser PODE
recuperar via cookie + GET com `x-indicio-guest-cart-token`.

Protocolo BFF (perda A):

1. Gerar `Idempotency-Key` só em memória para aquele create.
2. POST Store.
3. Após 201+header: o BFF detém a capability. Escrever cookie HttpOnly
   **antes** de qualquer sucesso browser-facing.
4. Não persistir a Idempotency-Key no cookie como substituto da capability.
5. Retry do browser PODE recuperar via cookie + GET com o header.
6. Se o BFF recebeu o 201 mas crashou **antes** do cookie: o secret em
   memória some; isso **não** é recuperável via replay da mesma key. Para
   posse, tratar como perda B (órfão + nova key).
   Retry **in-process enquanto o 201 ainda está em memória** é retry após
   resposta Store **já recebida**, **não** perda Store→BFF — não descrevê-lo
   como cobertura de perda Store→BFF.

#### B) Store commitou o create; resposta Store → BFF perdida ANTES de o BFF receber a capability

O BFF **não** possui o secret. Hash-only impede reconstrução.
`store-idempotency` pode recuperar somente contexto seguro.

1. Replay da **mesma** `Idempotency-Key` **NÃO** pode recuperar nem reemitir
   a capability.
2. `Idempotency-Key` **NÃO** é credencial de recuperação.
3. Retry PODE recuperar cart / contexto seguro (`cart_id`, DTO canônico,
   `ETag`) se o carrinho ainda for válido.
4. A capability perdida permanece irrecuperável; o carrinho fica
   órfão/inacessível.
5. O BFF inicia novo create com **nova** `Idempotency-Key`.
6. O órfão expira pela política de lifecycle/TTL (recomendação Q-02
   inalterada).

**Fence:** o protocolo de cookie é contrato do BFF futuro. Phase 15 (quando
executada) entrega mint hash-only + header Store→BFF + replay de contexto sem
secret. Não implementa storefront/Next.js. [LOCKED: frontend BLOCKED]

### Option B — REJECT

Reemitir a **mesma** capability sem plaintext é fisicamente impossível sob
hash-only. Replay de create **pode** devolver contexto sem header; sem cookie
isso não restaura posse — e **não deve**.

### Option C — REJECT (two-phase ack)

Não está no PRD. Plaintext viveria até o ack (secret persistido ou perda no
crash). D13-17 proíbe persistir capability para reproduzir resposta.

### Option D — REJECT (envelope cifrado)

Viola CART-01 / PRD §7.2 “persistida somente como hash”. Ciphertext recuperável
é o token.

### Option E — REJECT (HKDF como auth refresh)

PRD: “token gerado com no mínimo 32 bytes CSPRNG” / “persistência somente do
SHA-256”. CONTEXT Q-01: “Auth refresh capability é outra coisa.” Guardar nonce
+ secret de servidor reconstrói o token (= Option D). A capability deixaria de
ser CSPRNG e passaria a ser PRF.

### Constraints satisfeitos

1. CSPRNG emitido uma vez no mint do 201. Sem HKDF.
2. Persistência hash-only (Q-01).
3. Mesma `Idempotency-Key` PODE devolver o mesmo **contexto seguro** se o
   carrinho ainda for válido. A mesma key **NÃO** reemite nem restaura a
   capability na perda B. Recuperação via cookie aplica-se **somente** à
   perda A depois de o BFF ter recebido o header e gravado o cookie.
4. Não persiste plaintext.
5. Não põe capability em JSON/URL/logs.
6. Não faz Idempotency-Key prova de posse nem credencial de recuperação.
7. Não expõe ao browser.

**Residual (default):** perda B (e perda A sem cookie): carrinho
vazio/inacessível até TTL. Rotação-on-replay (novo CSPRNG, substitui hash,
emite header novo) **não** é default e só com lock humano — tensão com
“emitted once”.

Auth `recovery_until` 45s **não** se aplica (é recovery de refresh consumido).

## CAS / ETag / If-Match

- Consumir `StoreResourceVersion`; não reinventar. [LOCKED: D15-09]
- Integer monotônico; transação PostgreSQL; Redis não decide. Não usar schema
  bigint de `13-VALIDATION.md` (superseded HCD 13-05).
- Incrementar em add/update/delete/clear. GET não incrementa.
- Mutações: `If-Match` obrigatório; ausência fail-closed.
- Stale: 412 `CART_VERSION_MISMATCH` + snapshot sem capability.
- Sem retry destrutivo automático (D13-23).
- Idempotency não substitui `If-Match`. Após 412, **nova** intenção continua a
  exigir estado/versionamento apropriado.
- PLAN deve definir a precedência `Idempotency-Key × If-Match` em retries de
  mutação (ver Must Be Decided in PLAN). Esta RESEARCH **não** escolhe a
  implementação: retry da **mesma** intenção / **mesma** `Idempotency-Key`
  **não** deve virar `412 CART_VERSION_MISMATCH` só porque a primeira
  execução avançou o ETag.
- Versão errada ≠ posse errada — não fundir códigos de erro.

## Threat Model Applied

| Ameaça | Controle |
|---|---|
| Spoofing | Guest M1: capability necessária; compare timing-safe do SHA-256. Customer M1: guard BFF + `customerAuthAccessGuard` / estado PostgreSQL e o identity estável desse contexto. Native JWT/session Customer é **insuficiente** para M1. Erro uniforme D13-12; sessão Medusa insuficiente para guest M1 |
| Tampering | `If-Match` + CAS Postgres; 412; sem retry destrutivo |
| Elevation / Bypass | Nativos DENY; line-items só via rotas locais; complete BLOCKED; native `authenticate("customer")` não é autoridade M1 |
| Disclosure | Header-only; hash-only; BFF cookie HttpOnly; allowlist idempotência proíbe `capability`; exemplos sintéticos |
| Replay | Key ≠ ownership; replay devolve contexto, não secret; mesma key **NÃO** reemite capability após perda Store→BFF; `Idempotency-Key` não é credencial de recuperação; mutações guest ainda exigem o header da capability |

## Don't Hand-Roll

- Não inventar segundo motor de carrinho — usar workflows Medusa.
- Não reinventar CAS — `StoreResourceVersion`.
- Não reinventar claim idempotente — `store-idempotency`.
- Não copiar HKDF/nonce de auth refresh para guest cart.
- Não reabilitar HTTP nativo de line-items.
- Não persistir plaintext “temporário” em Redis.

## CART-01..CART-09 Coverage Matrix

| ID | Estado RESEARCH | Entrega (execução futura) |
|---|---|---|
| CART-01 | Q-01 módulo hash-only; Q-03 dual-run | Tabela + mint CSPRNG + header |
| CART-02 | Q-10 Store→BFF only | Header + redaction + OpenAPI sintético |
| CART-03 | Q-02 TTL 7d rec.; lifecycle | Validate/expire/revoke; consume na 16 |
| CART-04 | Q-09 key no POST; Q-11 contexto | Lazy create + idempotency wired |
| CART-05 | Q-05 workflow wrap + clear local | Rotas locais + DENY nativo |
| CART-06 | Wrapper local 1–99; 0=remove nativo | Zod local antes do workflow |
| CART-07 | Wire `StoreResourceVersion` | Bump estrutural |
| CART-08 | Q-08 DTO + ETag quoted | If-Match + 412 snapshot |
| CART-09 | Q-06 PA real + hooks no-op SHP | Chamadas em toda mutação + testes |

## Exact-Set Projection (execução, não este gate)

```text
# após Phase 15 execution (recomendado, não este gate)
total: 64
native identity: 51          # inalterado; 3 line-items = mesmas keys
local-only: 13               # 12 + DELETE collection
AUTHORIZED: 0
EXTENDED: 16                 # 15 + DELETE collection
BLOCKED: 17
OUTSIDE_FRONTEND_M1: 31
DENY: 47                     # 50 − 3 line-items
PRESERVE_LEGACY: 5           # 7 − 2 active
M1_ENABLED: 12               # 6 auth Phase 14 + 6 cart
m1_enablement enabled: 12
```

Cart M1 projetado: `GET/POST /store/carts/active` + 3 line-items por item +
`DELETE /store/carts/{id}/line-items`.

As 3 line-items **reutilizam** as keys já presentes no manifest
(`origin` → `native+local_extension` na execução). **Não** criar 3 entradas
`origin: local` duplicadas — isso quebraria `native identity` 51 e o exact-set.
Só `DELETE /store/carts/{id}/line-items` é key nova (`origin: local`).
[RECOMMENDATION: Subagent C + review D]

As 6 rotas Auth Phase 14 permanecem `M1_ENABLED`. `validateStoreSurfaceManifest`
hoje hardcoda `COUNT_TOTAL=63`, `COUNT_EXTENDED=15` e M1=6 — a execução deve
atualizar esses invariantes **sem remover** as 6 auth. `nativeLocalExtension`
hoje é 2 (products); se line-items forem para `native+local_extension`, o
contador sobe (2 → 5) e o teste correspondente precisa acompanhar.

## Validation Architecture

`workflow.nyquist_validation` aplica-se a PLAN futuro; este RESEARCH não cria
`15-VALIDATION.md` neste gate research-only.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest via Medusa (`apps/backend`) |
| Quick run | focused unit + HTTP paths |
| Authority | PostgreSQL para CAS, uniqueness do `token_hash`, idempotency claim |

### Phase Requirements → Test Map (para PLAN)

| Req ID | Behavior | Test Type |
|--------|----------|-----------|
| CART-01 | Hash-only persistido; plaintext ausente no DB | module + SQL |
| CART-01 | Sessão sozinha não autoriza mutação M1 | HTTP |
| CART-02 | Token ausente de body, URL, logs, OpenAPI examples | unit + lint scan |
| CART-03 | Expirado/revogado/consumido → erro uniforme | HTTP |
| CART-04 | Mesma Idempotency-Key → mesmo cart_id; GET não cria | HTTP |
| CART-04/Q-11 | Replay não devolve header da capability | HTTP |
| CART-05 | Workflow nativo via rota local; nativo HTTP ainda DENY | HTTP + guard |
| CART-06 | 1–99; 0 remove; rejeitar decimal/negativo/>99 | unit + HTTP |
| CART-07/08 | If-Match stale → 412 + snapshot sem token | HTTP + PG CAS |
| CART-09 | Mutação chama invalidação PA + hook SHP no-op | unit |
| FND/AUTH | Exact-set 6 auth intacto; complete DENY; zero Order | HTTP herdado |

### Sampling Rate

- Por task: unit focado
- Por wave: HTTP de cart + guard
- Phase gate: exact-set + CAS PG + scans de leakage de token

## Closed by Research

Fatos as-built e rejeições evidentes abaixo. Q-01..Q-11 continuam
**recomendações** até o humano lockar este RESEARCH; este arquivo **não**
autoriza PLAN nem execução. [LOCKED: D15-17, D15-18]

- Motor Medusa 2.16.0 para add/update/delete-per-item confirmado; clear-all HTTP
  nativo **ausente**; workflow multi-id **presente**.
- Validators nativos insuficientes para CART-06 → wrapper local.
- Q-11: Option A recomendada **após distinguir perda A vs B**; retry
  in-process com 201 em memória **não** é perda Store→BFF; B/C/D/E
  rejeitadas com evidência (não são D15 locks).
- Guest capability ≠ auth refresh HKDF.
- DTO = `PublicStoreCartPreOrder`; versão só em `ETag`.
- Dual-path Q-07: mesmas ops, provas distintas (guest capability vs
  contexto de acesso Customer Phase 14 — **não** atalho JWT/session).
- CART-09: PA real + hook no-op SHP; sem Gelato.

## Must Be Decided in PLAN

- Nome do módulo/tabela e module link Cart ↔ capability.
- Formato de encoding do token no header (base64url vs hex do CSPRNG).
- Lista BFF protegida: estender a de auth vs lista irmã de cart.
- Actor/resource scope hashes exatos no `store-idempotency` para create vs
  mutações. Guest = hash derivado da capability (sem plaintext); Customer =
  Customer/identity estável do contexto autorizado Phase 14; **não** JWT /
  hash do JWT / session id nativo Medusa. Refresh não pode mudar o scope
  enquanto a identity permanece. Inputs exatos de hash continuam decisão
  de PLAN.
- Se GET `/store/carts/active` sem cookie/capability retorna 404 (FE-CART-001)
  vs erro uniforme.
- Atualização de `validateStoreSurfaceManifest` / `COUNT_TOTAL` 64.
- Ordem das waves: módulo+CAS → BFF gate → promote active → line-items → clear.
- TTL 7d rolling como default de PLAN (humano pode ajustar no review do PLAN).
- **INTERAÇÃO `Idempotency-Key × If-Match`.** PLAN deve definir a
  precedência para retries de mutações, de forma que: (1) uma primeira
  mutação aplicada com sucesso incrementa a versão; (2) retry da **mesma**
  intenção / **mesma** `Idempotency-Key` não deve virar artificialmente
  `412 CART_VERSION_MISMATCH` só porque a própria primeira execução
  avançou o ETag; (3) `Idempotency-Key` continua a não substituir ownership
  nem `If-Match`; (4) nova intenção após conflito continua a exigir novo
  estado/versionamento apropriado. Esta RESEARCH **não** desenha a
  implementação.

## Human Decision Required Before PLAN

Este RESEARCH **não** autoriza iniciar PLAN. PLAN só depois de review humano
explícito e comando separado. [LOCKED: D15-17]

Dois pontos em que o humano pode divergir da recomendação sem reabrir RESEARCH:

1. **TTL numérico** (default RESEARCH: 7d rolling / teto 30d).
2. **Órfão Q-11:** aceitar carrinho vazio/inacessível até TTL após perda B
   (Store commitou, BFF nunca recebeu o secret) e após perda A se o cookie
   nunca foi gravado (**default**), vs rotação-on-replay (só com lock
   explícito; tensão com emit-once). Q-11 permanece recomendação de
   RESEARCH, não D15 lock.

Promoção exact-set 63→64 (e EXTENDED 15→16, local-only 12→13) é lock de
**review humano deste RESEARCH** (governança apontada pelo Subagent C), não
default silencioso de PLAN. A aritmética recomendada preserva as 6 auth Phase 14
e o contrato PRD de clear-all.

## Assumptions Log

| # | Claim | Risk if Wrong |
|---|---|---|
| A1 | “Contexto” em SRS-BE-CART-002 não inclui o secret da capability | Se produto exigir reemissão do token original, Q-11 fica insolúvel sob hash-only |
| A2 | BFF consegue setar cookie HttpOnly após 201 e antes da resposta browser (**perda A**) | Sem isso, posse na perda A não sobrevive no cookie; frontend BLOCKED nesta phase mitiga |
| A3 | Carrinho lazy no 201 está vazio — órfão da perda B (e da perda A sem cookie) tem custo baixo | Se create passar a hidratar itens, o custo do órfão sobe |
| A4 | `deleteLineItemsWorkflow(ids[])` é atômico o bastante para clear-all | Se o workflow falhar mid-ids, PLAN precisa de wrap transacional extra |
| A5 | Hook no-op SHP basta como evidência CART-09 até Phase 18 | Humano pode exigir tabela placeholder; ainda assim sem Gelato |
| A6 | Retry in-process com 201 ainda em memória **não** é perda Store→BFF | Tratar isso como perda B faria órfãos em excesso de casos A recuperáveis |

## Residual Risks / Landmines

1. Dual-run sessão + capability até Phase 19 — documentar matriz de provas por rota.
2. Emissão do header sem BFF gate se Q-04 promover cedo demais.
3. `GuestCartEnvelope.guestCartToken` vazar para DTO/OpenAPI.
4. Actor scope fraco no create (key global) → replay por terceiro. Scope
   Customer **não** pode ser JWT cru, hash do JWT nem session id Medusa.
5. `validateStoreSurfaceManifest` Phase 14 hardcode 6 M1.
6. Colisão semântica v1.0 CART-01..04 vs v1.1 CART-01..09.
7. Cookie TTL ≠ capability TTL.
8. Copiar análogo auth (nonce/HKDF/45s) por conveniência.
9. Reabilitar attach/complete/shipping nativos.
10. Usar `13-VALIDATION.md` bigint como schema de versão.

## Sources

### Primary (HIGH)

- `.planning/phases/15-guest-cart-capability-concurrency/15-CONTEXT.md`
- `.planning/REQUIREMENTS.md` CART-01..CART-09 v1.1
- `.planning/phases/13-storefront-contract-foundation-surface-lockdown/13-CLOSURE.md`, `13-05-SUMMARY.md`, `13-CONTEXT.md` (D13-*)
- `.planning/phases/14-customer-auth-verification/14-CLOSURE.md`, `14-CONTEXT.md` (D14-08)
- `docs/PRD_Backend_v1.1.md` §4.1, §7.2–7.3, §7.12, §11.4
- `docs/PRD_frontend_v1.1.md` §7.7, §9.6, §13.1–13.2
- `docs/SRS_v1.5.md` SRS-BE-CART-001..008, SRS 2.4, 3.1–3.2, 6.2, 11.3–11.5
- `docs/DB_MODEL_v1.21.md`, `docs/DB_MODEL_v1.22.md` (ausência guest-cart capability)
- As-built: `active/route.ts`, `active-cart.ts`, `serializers.ts`, `manifest.ts`,
  `guard.ts`, `store-resource-version/`, `store-idempotency/`,
  `cart-invalidation.ts`, `eligibility.ts`, `bff-service-auth.ts`,
  `customer-auth/access-guard.ts`,
  `customer-auth/security/capabilities.ts`, `tracking-access-token/service.ts`
- Instalado: `@medusajs/medusa@2.16.0` store cart middlewares/validators;
  `@medusajs/core-flows@2.16.0` add/update/delete line-item workflows

### Secondary (MEDIUM)

- Context7 `/websites/medusajs` — store cart line-items, `updateLineItemInCartWorkflow`
  qty 0 removes, custom API routes executing workflows
- `docs/FRONTEND_CONTRACT_TRACEABILITY.md` §5 FE-CART-*
- `AGENTS.md` stack table (stale 2.15.x)

### Subagent memos (this run)

- [As-built audit](63e28061-9319-44ca-b0a6-f384fe9fb040) — PASS
- [Security research](d5403eb5-52ea-499a-8f04-b0dc5d0565c0) — PASS
- [Medusa research](d35fb928-fed2-4242-9435-ab65640872ea) — PASS
- [Adversarial review](94c1cff4-afb1-47af-9389-bcd506e250ec) — PASS (warnings applied)

## Metadata

- Phase: 15-guest-cart-capability-concurrency
- Research date: 2026-08-19
- Mode: research-only (`/gsd-plan-phase 15 --research-phase`)
- PLAN: NOT AUTHORIZED
- EXECUTION: NOT AUTHORIZED
- PUSH / DEPLOY / FRONTEND: NONE / NONE / BLOCKED

---

## RESEARCH COMPLETE
