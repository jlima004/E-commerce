# Phase 16: Cart Merge & Review - Context

**Gathered:** 2026-08-22T21:49:13-03:00
**Status:** Awaiting human review

<domain>
## Phase Boundary

A Phase 16 substitui o attach simples de carrinho por um merge autenticado,
transacional, idempotente, parcial e revisável. O carrinho Customer canônico é
o destino quando existe; o guest cart é a origem. A phase deve materializar o
contrato e as invariantes de merge/review para `MRG-01..MRG-08`, preservando o
BFF-only boundary, a capability guest hash-only, a concorrência server-
authoritative e a proibição de criação síncrona de `Order`.

Esta discussão fixa decisões de produto e contrato suficientes para RESEARCH e
PLAN posteriores. Ela não autoriza RESEARCH, PLAN, SPEC/SDD, implementação,
testes de runtime, migrations, providers, deploy ou qualquer alteração remota.

### Requisitos da Phase 16

- `MRG-01`: substituir attach simples por merge autenticado, transacional e idempotente.
- `MRG-02`: retornar exatamente `MERGED`, `MERGED_PARTIAL`, `GUEST_CART_ATTACHED`, `CUSTOMER_CART_PRESERVED` ou `NO_ITEMS`.
- `MRG-03`: somar quantidades por variante até 99 sem duplicar itens em retry.
- `MRG-04`: rejeitar individualmente variantes inválidas/indisponíveis e preservar itens válidos no merge parcial.
- `MRG-05`: garantir rollback completo e consumir/revogar capability somente após commit bem-sucedido.
- `MRG-06`: persistir `requiresReview`, itens rejeitados e reconhecimento versionado.
- `MRG-07`: bloquear checkout enquanto `requiresReview=true` e permitir acknowledge idempotente.
- `MRG-08`: depreciar controladamente `/store/customers/me/cart/attach`, sem remoção silenciosa ou bypass do merge.

### Fora do boundary desta phase

- Não inventar uma regra de domínio apenas para tornar `CUSTOMER_CART_PRESERVED` alcançável.
- Não reabrir a criação guest, a capability, as mutações de line item ou a autoridade de `Order` fechadas na Phase 15.
- Não implementar checkout BR, CPF, consentimentos, quote/select Gelato, hardening de PaymentAttempt, confirmação assíncrona, resumo de Order ou kit final das Phases 17–22.
- Não iniciar frontend/BFF, provider real, deploy, migration remota, alteração de package ou infraestrutura remota neste gate.

</domain>

<decisions>
## Implementation Decisions

As decisões abaixo são vinculantes para RESEARCH e PLAN posteriores. A técnica
física exata pode ser comparada somente dentro destas fronteiras e após nova
autorização humana.

### 1. Destino canônico e outcomes

- **D16-01 — Customer é o destino:** quando existe exatamente um Customer cart canônico utilizável, ele permanece o destino. O guest cart é sempre a origem do conteúdo a incorporar. A Phase 16 deve substituir a promoção simples do attach legado por merge real no Customer.
- **D16-02 — Customer com itens:** com Customer e guest válidos, ambos com conteúdo, os itens guest são incorporados no Customer. Todos os itens incorporáveis retornam `MERGED`; aceitação parcial retorna `MERGED_PARTIAL`.
- **D16-03 — Customer vazio continua utilizável:** um Customer cart ativo e válido, ainda que vazio, continua sendo o destino canônico. Guest com itens nesse cenário produz `MERGED` ou `MERGED_PARTIAL`, nunca `GUEST_CART_ATTACHED`.
- **D16-04 — Ausência de destino utilizável:** se não existe Customer cart ativo/canônico utilizável e existe guest cart válido com conteúdo elegível, o guest é promovido/associado ao Customer sem criar outro cart apenas para copiar itens. O outcome é `GUEST_CART_ATTACHED`.
- **D16-05 — Nenhum item incorporável:** se zero itens forem efetivamente incorporados, o outcome é `NO_ITEMS`. O Customer não sofre alteração estrutural; o guest permanece guest; a capability permanece válida; nenhum cart é transferido e nenhum `Order` é criado. `NO_ITEMS` pode incluir `rejectedItems`.
- **D16-06 — Canonicalidade ambígua:** se houver mais de um candidato Customer sem autoridade inequívoca, o merge falha fechado, nenhum cart é alterado, a capability não é consumida e a resposta é um erro estável de conflito/estado, provavelmente HTTP 409. `updated_at DESC` pode ser usado para ordenação/diagnóstico, mas nunca para decidir canonicalidade.
- **D16-07 — Preservação não é fallback:** `CUSTOMER_CART_PRESERVED` só pode ser emitido quando existe exatamente um Customer cart canônico, existe guest cart válido e uma regra de domínio determinística previamente aprovada impede o merge naquela operação. Nesse outcome, Customer permanece exatamente como estava, guest permanece guest, zero itens são incorporados, a capability permanece válida e nenhum efeito estrutural é confirmado.
- **D16-08 — Não mascarar anomalias:** `CUSTOMER_CART_PRESERVED` não deve esconder ausência de Customer, guest sem itens, todos os itens rejeitados, ambiguidade de canonicalidade, erro técnico, rollback, conflito de concorrência ou conflito de idempotência. Não há ainda gatilho concreto aprovado para esse outcome; RESEARCH/PLAN devem manter essa lacuna explícita e não inventar uma regra.

### 2. Normalização e merge parcial

- **D16-09 — Intenção guest normalizada por variante:** antes de comparar com o Customer, o merge agrega todas as linhas guest com o mesmo `variantId`. Linhas físicas duplicadas são normalizadas, não tratadas como erro de domínio. Deve existir no máximo uma decisão/rejeição por variante.
- **D16-10 — Limite 99 sem reduzir Customer:** para uma variante, seja `C` a quantidade Customer e `G` a quantidade guest agregada. Se `C + G <= 99`, aceita `G`; se `C + G > 99`, aceita `99 - C` e rejeita `G - (99 - C)`. A quantidade Customer existente nunca é reduzida para acomodar o guest.
- **D16-11 — Overflow localizado:** overflow de uma variante não provoca rollback global. Itens válidos de outras variantes continuam sendo processados. Quando parte for aceita e parte rejeitada, o outcome é `MERGED_PARTIAL`.
- **D16-12 — Todos rejeitados:** se todas as variantes forem rejeitadas e `acceptedQuantity` total for zero, o outcome é `NO_ITEMS`, não `MERGED_PARTIAL`. O Customer permanece intacto e a capability não é consumida.
- **D16-13 — Rejeição mínima e fechada:** cada `rejectedItem` deve conter somente um identificador público seguro de variante, `requestedQuantity`, `acceptedQuantity`, `rejectedQuantity` e um reason code fechado. O contrato conceitual dos motivos é:
  - `VARIANT_INVALID`;
  - `VARIANT_UNAVAILABLE`;
  - `QUANTITY_LIMIT_EXCEEDED`.
- **D16-14 — Invariante de quantidades:** `requestedQuantity` é a quantidade guest agregada originalmente pretendida; `acceptedQuantity` é o que foi incorporado; `rejectedQuantity = requestedQuantity - acceptedQuantity`; `acceptedQuantity + rejectedQuantity = requestedQuantity`.
- **D16-15 — Sem snapshot de catálogo:** `rejectedItems` não deve expor preço, total, provider/Gelato ID, metadata interna, SKU operacional não público, detalhes de estoque, exceções/mensagens técnicas, título, imagem ou descrição. O frontend/BFF resolve apresentação a partir do catálogo canônico quando possível.

### 3. Review e acknowledge

- **D16-16 — Equivalência de review:** `requiresReview=true` se e somente se `outcome=MERGED_PARTIAL`. `MERGED`, `GUEST_CART_ATTACHED`, `CUSTOMER_CART_PRESERVED` e `NO_ITEMS` retornam `requiresReview=false`.
- **D16-17 — Review representa divergência aplicada:** `requiresReview` significa que o Customer cart foi efetivamente alterado, mas a intenção guest não foi preservada integralmente. Isso inclui todos os motivos de rejeição, inclusive `QUANTITY_LIMIT_EXCEEDED`.
- **D16-18 — NO_ITEMS não altera Customer:** rejeições em `NO_ITEMS` são informação sobre uma tentativa, não estado de revisão do cart resultante. Não persistir review no Customer cart nesse outcome.
- **D16-19 — Estado público fechado:** respostas de merge e acknowledge devem incluir o cart canônico e um estado de review com:
  - `requiresReview: boolean`;
  - `reviewRef: string | null`;
  - `rejectedItems: RejectedItem[]`.
  `reviewRef` é opaco, público e específico da revisão; não é identificador do cart.
- **D16-20 — Separação de autoridades:** o `ETag` permanece no header como autoridade de versão/concorrência; `reviewRef` identifica a revisão pendente. Um não substitui o outro.
- **D16-21 — Dados proibidos no review público:** não expor timestamps de criação/ack, histórico, actor IDs, hashes/fingerprints internos, IDs de registros, detalhes de workflow, histórico de ETags ou auditoria completa.
- **D16-22 — Acknowledge versionado:** acknowledge deve corresponder à revisão e ao estado exatos produzidos pelo `MERGED_PARTIAL`, usando `If-Match`/`ETag` ou versão equivalente. Versão stale retorna `412`/mismatch e mantém `requiresReview=true`.
- **D16-23 — Acknowledge idempotente:** acknowledge válido limpa `requiresReview`, encerra publicamente a revisão e não deve provocar novo bump estrutural. Repetir o mesmo `reviewRef` já reconhecido retorna o cart atual com `requiresReview=false`, sem novo efeito.
- **D16-24 — Sem revisão pendente:** acknowledge sem revisão pendente é no-op normal: retorna o cart atual com `requiresReview=false`, sem mutação e sem bump.
- **D16-25 — Referência divergente:** `reviewRef` desconhecido, pertencente a outra revisão/cart ou incompatível com a intenção não é replay válido e deve falhar fechado.
- **D16-26 — Mutação posterior:** mutação estrutural posterior torna o acknowledge da versão anterior inaplicável à nova versão, mas não reativa `requiresReview` automaticamente. Review só volta a ser exigido quando existir novo `MERGED_PARTIAL`.

### 4. Idempotência, concorrência e capability

- **D16-27 — Escopo da Idempotency-Key:** a chave de merge é escopada semanticamente por operação, Customer, guest cart, Customer cart destino e versões relevantes. No caso de promoção sem Customer cart, `customerCartId = null` faz parte do fingerprint.
- **D16-28 — Fingerprint determinístico:** o fingerprint deve conter, no mínimo, operação (`CART_MERGE`), Customer, guest cart, destino ou `null`, versão guest, versão Customer quando existente e `normalizedGuestIntent` já agregado por variante.
- **D16-29 — Replay e conflito:** mesma chave + mesmo fingerprint/contexto autoritativo reproduz o resultado original sem novo merge, consumo, revisão ou bump. Mesma chave + fingerprint incompatível falha fechado com conflito de idempotência e nenhum efeito.
- **D16-30 — Capability não é chave:** capability guest não é substituída por `Idempotency-Key`, não entra em plaintext no fingerprint e não concede autorização por si só. O registro pode vincular a operação à identidade segura/hash/registro autoritativo da capability.
- **D16-31 — Replay pós-consumo:** após commit e consumo/revogação da capability, um retry compatível continua possível por registro de idempotência `COMMITTED`. Customer JWT e BFF continuam obrigatórios; a capability consumida só é aceita para replay que corresponda à mesma chave, fingerprint, Customer e referência segura. Nunca volta a autorizar nova mutação.
- **D16-32 — Registro seguro:** persistir somente referências/metadados necessários para replay: Customer, carts, referência/hash seguro da capability, fingerprint, versões, outcome, cart canônico e `reviewRef` quando aplicável. Não persistir capability plaintext, JWT, headers de autenticação, provider IDs desnecessários ou payloads sensíveis.
- **D16-33 — Não reconstruir replay pelo estado atual:** replay continua representando a operação originalmente concluída, mesmo após acknowledge ou alterações posteriores do cart. A forma exata de resposta — snapshot original ou cart atual acompanhado do outcome original — pertence ao contrato/RESEARCH; efeitos nunca são reaplicados.
- **D16-34 — Concorrência com chaves diferentes:** tentativas concorrentes sobre o mesmo guest/Customer conjunto de recursos são serializadas pela autoridade transacional. A vencedora revalida estado e executa; a seguinte relê carts, capability e versões sob lock e falha sem reaplicar efeitos. Chaves diferentes nunca herdam replay.
- **D16-35 — Distinção conceitual de erros:** `412` representa precondição/versão stale; `409` representa conflito de estado válido, como capability consumida por outra intenção. O mapeamento HTTP exato deve preservar o contrato existente e ser confirmado em RESEARCH/PLAN.
- **D16-36 — Commit e capability:** capability só é consumida/revogada e o guest cart só é marcado superseded/inativo depois do commit bem-sucedido da transferência/merge. Falha técnica ou rollback não pode deixar efeito parcial confirmado.

### 5. Depreciação do attach

- **D16-37 — Um único motor semântico:** `/store/customers/me/cart/attach` não mantém uma segunda semântica de mutação. Durante a janela de depreciação, só pode funcionar como fachada compatível que delega ao mesmo serviço/workflow autoritativo do merge.
- **D16-38 — Contrato novo obrigatório no adaptador:** o attach legado só pode mutar quando o request satisfizer BFF caller válido, Customer JWT, guest capability válida ou replay elegível, `Idempotency-Key` e precondições/versionamento compatíveis.
- **D16-39 — Sessão legada não faz fallback:** request baseado apenas em sessão/estado legado recebe erro estável de migração/depreciação, com zero mutação, sem consumo de capability, sem promoção de cart e sem `Order`.
- **D16-40 — Outcomes preservados:** quando delegar, o attach retorna somente os mesmos cinco outcomes, o mesmo estado de review, o mesmo replay idempotente e a mesma semântica de concorrência do endpoint canônico. Não criar outcomes próprios de compatibilidade.
- **D16-41 — Fora do M1:** o attach permanece temporariamente existente e deprecated, mas fora do contrato Store M1. O endpoint canônico de M1 é `/store/customers/me/cart/merge` e o acknowledge é `/store/carts/{id}/review/acknowledge`.
- **D16-42 — Estágios de remoção:** Phase 16 mantém o adaptador controlado; depois da migração dos consumidores, a rota pode responder somente erro deprecado; a remoção final e sua data/gate ficam para PLAN posterior. Não há remoção silenciosa neste CONTEXT.

### the agent's Discretion

Não há discricionariedade para relaxar Customer-as-destination, outcomes fechados,
normalização por variante, teto 99, `NO_ITEMS`, equivalência
`requiresReview ↔ MERGED_PARTIAL`, hash-only/header-only capability, BFF-only,
idempotência, serialização transacional, rollback, ausência de `Order` ou
depreciação sem bypass.

RESEARCH/PLAN poderá comparar a técnica física de persistência do review,
`reviewRef`, fingerprint e registros de idempotência; a autoridade concreta
para canonicalidade; locks/transações; schemas/headers OpenAPI; e os códigos
HTTP finais, sempre sem inventar a regra de `CUSTOMER_CART_PRESERVED` ou
relaxar as decisões acima.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Governance and phase state

- `.planning/PROJECT.md` — Core Value, boundary backend-only, invariantes de `Order`, constraints e bloqueio do frontend.
- `.planning/STATE.md` — autorização limitada à captura do CONTEXT, governança manual, `parallelization=false` e gates posteriores não autorizados.
- `.planning/ROADMAP.md` — objetivo da Phase 16, dependência da Phase 15 e separação entre CONTEXT e RESEARCH/PLAN.
- `.planning/REQUIREMENTS.md` — autoridade de `MRG-01..MRG-08` e rastreabilidade `FE-CART-006/007`.
- `.planning/MILESTONES.md` — abertura do milestone v1.1 e separação entre backend e Frontend M1.
- `.planning/config.json` — modo interativo, sem auto-advance/auto-chain e sem paralelização.
- `.planning/milestones/v1.1-ROADMAP.md` — sequência linear das Phases 13–22.
- `.planning/milestones/v1.1-REQUIREMENTS.md` — snapshot dos requisitos do milestone.

### Accepted Phase 15 authorities

- `.planning/phases/15-guest-cart-capability-concurrency/15-CONTEXT.md` — decisões D15 sobre capability hash-only, atores, carts, ETag/If-Match, idempotência e boundaries herdados.
- `.planning/phases/15-guest-cart-capability-concurrency/15-CLOSURE.md` — closure humano de CART-01..CART-09, exact-set Store, zero Order e capability/concurrency aceitos.
- `.planning/phases/15-guest-cart-capability-concurrency/15-PR27-REMEDIATION.md` — remediações aceitas para autoridade transacional Cart/PaymentAttempt, snapshot/ETag e compensações.
- `.planning/phases/15-guest-cart-capability-concurrency/15-08-SUMMARY.md` — ledger final aceito, capability consumível, CAS/ETag e evidência de zero Order.
- `.planning/phases/14-customer-auth-verification/14-CONTEXT.md` — D14, especialmente preservação do cart durante expiração/revogação de sessão.
- `.planning/phases/14-customer-auth-verification/14-CLOSURE.md` — autoridade de Customer/auth e invariantes zero-Order aceitos.
- `.planning/phases/13-storefront-contract-foundation-surface-lockdown/13-CONTEXT.md` — BFF-only, fail-closed, erros minimizados, idempotência, ETag/If-Match e native reuse.
- `.planning/phases/13-storefront-contract-foundation-surface-lockdown/13-CLOSURE.md` — closure de FND-01..FND-08 e superfície Store.

### Product, system and data contracts

- `docs/PRD_Backend_v1.1.md` §4.1, §6.2–6.4, §7.2–§7.4 — BFF boundary, Store contract, cart mutations, merge outcomes, review and deprecation target.
- `docs/PRD_frontend_v1.1.md` §4.1, §7.2–§7.4 — responsabilidade do BFF, capability server-side e consumo futuro de merge/review.
- `docs/FRONTEND_CONTRACT_TRACEABILITY.md` §5 — `FE-CART-001..008`, `CartMergeResponse`, `CartReviewState`, rejected items e provas esperadas.
- `docs/SRS_v1.5.md` — requisitos normativos de carrinho, limites do visitante e BFF boundary.
- `docs/DB_MODEL_v1.21.md` — invariantes de dados e necessidade de reconciliar nova persistência com o modelo vigente.
- `docs/DB_MODEL_v1.22.md` — snapshot mais recente do modelo, ainda sem decidir a persistência específica de merge/review desta phase.

### Current cart and capability implementation

- `apps/backend/src/modules/checkout/attach-guest-cart.ts` — decisão e comportamento do attach legado que a Phase 16 deve substituir por merge.
- `apps/backend/src/api/store/customers/me/cart/attach/route.ts` — rota legada, seleção atual e transferência/superseding que não pode continuar como semântica paralela.
- `apps/backend/src/api/store/carts/active/route.ts` — criação/recuperação de cart, capability e active-cart authority.
- `apps/backend/src/api/store/carts/customer-active-cart.ts` — resolução do Customer active cart a ser verificada sob autoridade transacional.
- `apps/backend/src/modules/checkout/active-cart.ts` — atores guest/Customer, ownership, active/superseded semantics e proteção pre-Order.
- `apps/backend/src/api/store/carts/line-item-mutation.ts` — pipeline transacional de mutação, CAS, snapshot e invalidation seams reutilizáveis.
- `apps/backend/src/api/store/carts/serializers.ts` — DTO público `PublicStoreCartPreOrder` e allowlist de resposta.
- `apps/backend/src/modules/guest-cart-capability/service.ts` — lookup, hash-only lifecycle, consume/revoke, rolling TTL e locks de autoridade.
- `apps/backend/src/modules/guest-cart-capability/types.ts` — header, registro e contexto transacional da capability.
- `apps/backend/src/modules/store-idempotency/operations.ts` — operações idempotentes cart existentes e extensão futura para merge.
- `apps/backend/src/modules/store-idempotency/service.ts` — claim, fingerprint, replay, conflitos e safe metadata persistida.
- `apps/backend/src/modules/store-resource-version/service.ts` — versão server-authoritative, initialize/increment/CAS e contexto transacional.
- `apps/backend/src/api/store-surface/manifest.ts` — attach `BLOCKED/DENY`, políticas da superfície e owner domain cart.
- `apps/backend/src/api-docs/operations/store/carts.ts` — registry TypeScript vigente para cart, headers, errors e fonte de contrato.

### Existing evidence and test integration points

- `apps/backend/integration-tests/http/cart-checkout-store.spec.ts` — matriz HTTP cart/checkout e zero-Order boundary.
- `apps/backend/integration-tests/http/customer-cart-active.spec.ts` — active cart Customer e seleção atual.
- `apps/backend/integration-tests/http/guest-cart-idempotency.spec.ts` — idempotency claim/replay e capability create lifecycle.
- `apps/backend/integration-tests/http/guest-cart-mutation-snapshot-concurrency.spec.ts` — ETag/If-Match/CAS e snapshots canônicos.
- `apps/backend/integration-tests/http/guest-cart-native-deny.spec.ts` — negative proof de bypass nativo.
- `apps/backend/integration-tests/modules/guest-cart-order-invariants.postgres.spec.ts` — autoridade de Order e isolamento pre-Order.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `resolveCanonicalCustomerActiveCart` e os helpers de active cart já representam o ponto de integração para encontrar o destino Customer; a Phase 16 deve verificar sua autoridade e falhar fechado quando houver mais de um candidato.
- `apps/backend/src/api/store/carts/line-item-mutation.ts` já possui pipeline transacional, contexto compartilhado, CAS, snapshot cart/version e integração com invalidation; serve como padrão de atomicidade, sem presumir que o merge seja apenas uma mutação de line item.
- `GuestCartCapabilityModuleService` já implementa hash-only, lookup constante, lifecycle active/consumed/revoked/expired e lock de autoridade cart; consume/revoke devem ocorrer somente na transação/commit aprovado pelo plano.
- `StoreIdempotencyModuleService` já implementa escopo, fingerprint semântico, claim/replay/conflict, estados terminais e metadata segura; merge deve ter operação própria e não reutilizar `CheckoutCompletionLog`.
- `StoreResourceVersionModuleService` fornece versão monotônica server-authoritative e CAS PostgreSQL; ETag/If-Match e review acknowledge devem se integrar a esse padrão.
- `serializeStoreCartPreOrder` e a registry de carts oferecem allowlist de DTO e headers; `CartReviewState`/`CartMergeResponse` devem seguir a mesma disciplina sem snapshots de catálogo ou capability.

### Established Patterns

- BFF same-origin é o único consumidor Store autorizado; JWT, capability e headers sensíveis não atravessam o browser.
- PostgreSQL é a verdade para unicidade, locks, versão e atomicidade; Redis não é autoridade de merge ou canonicalidade.
- Superfície desconhecida, nativa ou sem paridade de invariantes permanece fail-closed/DENY.
- Idempotency-Key, ownership, capability, locking, constraints e optimistic concurrency são mecanismos distintos e complementares.
- Capability é bearer secreto hash-only/header-only; nenhum token plaintext, JWT, fingerprint bruto ou PII deve ser persistido ou logado.
- Erros públicos usam vocabulário fechado e minimizado; conflitos de autorização não enumeram carts alheios.
- Cart paths permanecem pre-Order; nenhuma operação de merge/review pode criar `Order` ou contornar o webhook Stripe canônico.
- A resposta cart deve ser um par coerente de snapshot e versão/ETag; não combinar body de uma versão com header de outra.

### Integration Points

- Novo endpoint canônico: `POST /store/customers/me/cart/merge`, com Customer JWT, guest capability, Idempotency-Key, precondições e o contrato de cinco outcomes.
- Novo endpoint de revisão: `POST /store/carts/{id}/review/acknowledge`, versionado por If-Match/ETag e `reviewRef`.
- `/store/customers/me/cart/attach` deve permanecer apenas como adaptador controlado, fora do M1, sem fallback de sessão legado.
- Active Customer cart resolver, guest capability link/lifecycle, cart line-item engine, StoreResourceVersion, StoreIdempotency e cart serializer precisam compartilhar autoridade transacional suficiente para evitar double-merge.
- `requiresReview` deverá ser consumido por guards de checkout posteriores; esta phase define o bloqueio sem implementar o checkout BR da Phase 17.
- Registry `apps/backend/src/api-docs/operations/store/carts.ts`, schemas/headers/errors e suites HTTP/PG serão atualizados somente em gate de implementação autorizado.

</code_context>

<specifics>
## Specific Ideas

### Destination matrix

```text
1 Customer cart canônico + guest com itens
  → Customer é destino
  → MERGED ou MERGED_PARTIAL

0 Customer carts canônicos utilizáveis + guest elegível com itens
  → guest é promovido/associado
  → GUEST_CART_ATTACHED

Customer cart vazio e ativo + guest com itens
  → Customer continua destino
  → MERGED ou MERGED_PARTIAL

zero itens incorporáveis
  → NO_ITEMS
  → nenhum cart alterado e capability preservada

canonicalidade ambígua
  → erro fail-closed
  → nenhum efeito
```

### Partial merge example

```text
Customer variant A = 80
Guest variant A = 30

acceptedGuestQuantity = 19
rejectedGuestQuantity = 11
finalCustomerQuantity = 99
outcome = MERGED_PARTIAL
requiresReview = true
```

`rejectedItems` registra a intenção agregada por variante, não cada linha
física. `acceptedQuantity + rejectedQuantity = requestedQuantity`.

### Review example

```text
MERGED_PARTIAL v10
  → requiresReview=true
  → reviewRef=R1
  → ETag="<v10>"

ACK R1 + If-Match v10
  → requiresReview=false
  → reviewRef=null
  → rejectedItems=[]
  → nenhum novo bump
```

Uma mutação estrutural para v11 invalida a aplicabilidade do acknowledge v10,
mas não reativa review automaticamente. Um novo `MERGED_PARTIAL` cria nova
revisão.

### Idempotency example

```text
K + F + COMMITTED
  → replay do resultado original
  → capability consumida aceita somente para esse replay
  → nenhum merge/consume/review/version bump novo

K + fingerprint incompatível
  → conflito
  → nenhuma mutação
```

`normalizedGuestIntent` é a intenção agregada por variante. O segredo bruto da
capability nunca entra no fingerprint persistido.

### Attach migration example

```text
attach com contrato novo completo
  → delega ao mesmo merge autoritativo

attach baseado somente em sessão legada
  → erro estável de migração/depreciação
  → zero mutação
```

</specifics>

<deferred>
## Deferred Ideas

- Nenhuma nova capacidade foi adicionada; a discussão permaneceu dentro de `MRG-01..MRG-08`.
- A regra de domínio concreta que poderia emitir `CUSTOMER_CART_PRESERVED` permanece deliberadamente não definida e deve ser tratada apenas em RESEARCH/PLAN autorizado.
- Persistência física de `CartReviewState`, geração/forma de `reviewRef`, schema OpenAPI/Zod exato, fingerprint físico, lock/transaction implementation e mapeamento final 409/412 permanecem para RESEARCH/PLAN.
- O prazo/gate exato para converter o attach adaptador em erro deprecado e removê-lo fica para PLAN posterior; não há remoção silenciosa nesta phase.
- Checkout BR, CPF, consentimentos, shipping quote/select, PaymentAttempt M1, confirmação assíncrona, Order summary, catálogo, kit final, frontend, providers e deploy continuam atribuídos às phases posteriores ou fora do milestone autorizado.

</deferred>

## Manual Review Gate

Este CONTEXT é o único artefato autorizado nesta etapa. Após sua materialização,
o fluxo deve parar para revisão humana. `16-RESEARCH.md`, PLAN, SPEC/SDD,
implementation prompt, execução, verification, review, closure, deploy,
providers e infraestrutura remota não estão autorizados por este documento.

---

*Phase: 16-cart-merge-review*
*Context gathered: 2026-08-22T21:49:13-03:00*
*Gate: CONTEXT generated — awaiting human review*
*RESEARCH / PLAN / EXECUTION: NOT AUTHORIZED*
