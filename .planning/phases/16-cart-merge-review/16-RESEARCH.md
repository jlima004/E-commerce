# Phase 16: Cart Merge & Review - Research

**Researched:** 2026-08-22
**Domain:** merge transacional de carts, idempotência, capability guest e revisão versionada
**Confidence:** HIGH para fatos do repositório e decisões vinculantes; MEDIUM para escolhas físicas propostas que ainda requerem aprovação humana

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

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

### Deferred Ideas (OUT OF SCOPE)

- Nenhuma nova capacidade foi adicionada; a discussão permaneceu dentro de `MRG-01..MRG-08`.
- A regra de domínio concreta que poderia emitir `CUSTOMER_CART_PRESERVED` permanece deliberadamente não definida e deve ser tratada apenas em RESEARCH/PLAN autorizado.
- Persistência física de `CartReviewState`, geração/forma de `reviewRef`, schema OpenAPI/Zod exato, fingerprint físico, lock/transaction implementation e mapeamento final 409/412 permanecem para RESEARCH/PLAN.
- O prazo/gate exato para converter o attach adaptador em erro deprecado e removê-lo fica para PLAN posterior; não há remoção silenciosa nesta phase.
- Checkout BR, CPF, consentimentos, shipping quote/select, PaymentAttempt M1, confirmação assíncrona, Order summary, catálogo, kit final, frontend, providers e deploy continuam atribuídos às phases posteriores ou fora do milestone autorizado.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MRG-01 | Substituir attach simples por merge autenticado, transacional e idempotente. | Motor único, autoridade dual Customer+capability, transação PostgreSQL e adapter sem fallback. |
| MRG-02 | Retornar exatamente os cinco outcomes fechados. | Matriz de decisão abaixo mantém quatro outcomes alcançáveis e `CUSTOMER_CART_PRESERVED` reservado. |
| MRG-03 | Somar quantidades por variante até 99 sem duplicar em retry. | Normalização determinística, algoritmo de aceite e receipt idempotente. |
| MRG-04 | Rejeitar variantes individualmente e preservar itens válidos. | Classificador fechado por variante e execução parcial no workflow transacional. |
| MRG-05 | Rollback completo e capability terminal somente com commit. | Um único transaction manager e failpoints PostgreSQL em cada write. |
| MRG-06 | Persistir review, rejeições e acknowledge versionado. | `CartMergeResult` imutável e `CartReview` versionado, fora de `Cart.metadata`. |
| MRG-07 | Bloquear checkout com review pendente e permitir acknowledge idempotente. | Consulta autoritativa de review pendente e endpoint CAS sem bump estrutural. |
| MRG-08 | Depreciar attach sem remoção silenciosa ou bypass. | Fachada controlada, fora do M1, que delega ao mesmo motor e nega sessão legada. |

Todos os requisitos `MRG-01..MRG-08` permanecem **OPEN**; esta pesquisa não altera sua rastreabilidade nem os contadores do milestone. [VERIFIED: `.planning/REQUIREMENTS.md`, `.planning/STATE.md`]
</phase_requirements>

## Summary

O código existente contém quase todos os mecanismos elementares, mas não uma unidade transacional de merge. O pipeline de line items já demonstra o padrão correto de transação Medusa compartilhada, advisory lock PostgreSQL, reautorização da capability, CAS, invalidation e snapshot/ETag coerente. Entretanto, o attach atual seleciona o cart Customer por `updated_at DESC`, aceita sessão como autoridade e reparte transferência, update e superseding entre workflows independentes; ele não pode ser promovido a motor da Phase 16. [VERIFIED: `apps/backend/src/api/store/carts/line-item-mutation.ts`; `apps/backend/src/api/store/customers/me/cart/attach/route.ts`; `apps/backend/src/api/store/carts/customer-active-cart.ts`]

A recomendação é criar um único serviço/workflow `CartMerge` que opere dentro de uma transação PostgreSQL e seja usado pelo endpoint canônico e pelo adapter deprecated. Ele deve adquirir primeiro uma autoridade de escopo Customer, selecionar `none|single|ambiguous`, travar guest e destino em ordem estável, revalidar tudo dentro da transação e confirmar juntos carts/lines, versões, invalidation, review, receipt, idempotência e lifecycle da capability. A palavra “depois” em D16-36 deve ser implementada como “o update terminal fica dentro da mesma transação e só se torna visível no COMMIT”; consumir em uma segunda transação depois do commit criaria a janela de double-merge que a decisão proíbe. [RECOMMENDATION, confidence HIGH]

O gap estrutural é a idempotência. `StoreIdempotency` já faz HMAC da chave e SHA-256 do objeto canônico, mas `claim` e terminalização abrem/escrevem fora da transação do cart e a metadata pública aceita apenas escalares allowlisted. A Phase 16 precisa de operações transaction-aware e de um `CartMergeResult` imutável que carregue o receipt mínimo necessário para replay pós-consumo. `CartReview` deve ser persistência própria e vinculada a uma versão estrutural; `Cart.metadata` não oferece constraints, CAS ou histórico seguro. [VERIFIED: `apps/backend/src/modules/store-idempotency/service.ts`; `apps/backend/src/modules/checkout/active-cart.ts`; `docs/DB_MODEL_v1.22.md`]

**Primary recommendation:** planejar um motor único de merge em transação PostgreSQL, com autoridade Customer materializada, lock ordering global, receipt idempotente e review versionado; não reutilizar a decisão do attach nem inventar um branch para `CUSTOMER_CART_PRESERVED`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Autenticar BFF + Customer JWT + capability | API / Backend | Database / Storage | O browser não recebe capability; as três autoridades devem ser avaliadas independentemente antes de qualquer mutação. |
| Selecionar exatamente um Customer cart | Database / Storage | API / Backend | Unicidade, lock e revalidação são server-authoritative/PostgreSQL; a API traduz ambiguidade em conflito público. |
| Normalizar e classificar linhas guest | API / Backend | Database / Storage | Regra determinística de domínio executada sobre snapshot travado. |
| Aplicar merge/promoção e invalidation | API / Backend | Database / Storage | Workflows nativos Medusa executam os writes, todos no mesmo transaction manager. |
| Idempotência e replay pós-consumo | Database / Storage | API / Backend | Unique claim e receipt são duráveis; a API autentica e serializa o replay. |
| Persistir/acknowledge review | Database / Storage | API / Backend | Estado e versão são persistidos; endpoint expõe projeção pública fechada. |
| ETag/If-Match e snapshot | Database / Storage | API / Backend | Versão e body são capturados sob o mesmo snapshot, header é serialização HTTP. |
| Manifest/OpenAPI/Zod/serializers | API / Backend | — | O registry TypeScript e as allowlists definem o contrato Store futuro. |
| Bloqueio de checkout por review | API / Backend | Database / Storage | Guards futuros consultam o review autoritativo; nenhuma lógica vai ao frontend nesta phase. |

## Project Constraints (from AGENTS.md)

- Responder em Português do Brasil.
- Backend MVP em Medusa v2 + Node.js + TypeScript; PostgreSQL é a persistência relacional e Redis não substitui autoridade transacional.
- Nenhum `Order` pode nascer antes do webhook Stripe canônico; merge/review são estritamente pre-Order.
- Capability, tokens, secrets, dados completos de cartão e identificadores sensíveis não podem aparecer em logs, contratos ou exemplos.
- O registry TypeScript em `apps/backend/src/api-docs/` é a autoridade OpenAPI; JSON gerado nunca é editado manualmente.
- Mudança HTTP futura deve atualizar registry e evidência; exclusão intencional exige motivo, owner e gatilho de revisão.
- `openapi:check` é read-only, exige checkout limpo e não pode ser “reparado” por writer executado dentro/imediatamente antes do gate.
- Swagger continua não interativa e exemplos permanecem sintéticos, sem capability, JWT, provider IDs, payload Pix ou PII.
- Frontend, provider real, deploy e infraestrutura remota estão fora do gate.
- O workflow atual autorizou somente RESEARCH; PLAN, SPEC/SDD e execução não podem ser iniciados.

Estas diretivas são verificadas em `AGENTS.md`, `RTK.md` e no bloco de governança do `16-CONTEXT.md`. [VERIFIED: repository]

## Baseline Verificado e Gaps

| Área | Estado atual | Consequência para o PLAN posterior |
|------|--------------|-------------------------------------|
| Customer cart | `selectCanonicalCustomerActiveCart` filtra ativos/incompletos, ordena por `updated_at` e escolhe o primeiro. | Substituir por resultado discriminado e autoridade sob lock; atualizar teste que hoje cristaliza “mais recente vence”. |
| Attach | Usa `session.active_cart_id`, permite autoridade de sessão e executa três workflows separados. | Manter só fachada; remover a decisão semântica própria e delegar ao motor comum. |
| Ator cart | `resolveM1CartActor` escolhe guest quando capability existe e não autentica simultaneamente Customer. | Criar resolver dual-authority específico do merge; Customer JWT e capability são ambos obrigatórios. |
| Capability | Hash-only, lifecycle e row lock já existem; `consume/revoke` aceitam `sharedContext`. Lookup ativo rejeita consumed e pode renovar TTL. | Primeira execução usa `touch:false` no preflight e reautoriza dentro da tx; replay terminal usa lookup seguro separado, sem touch/reativação. |
| Line item | Pipeline já usa cart transaction, advisory lock, CAS, workflow proxy, invalidation e snapshot interno. | Reusar padrão/seams, não tratar merge multi-cart como simples wrapper de uma mutação. |
| Idempotência | HMAC da key, fingerprint canônico e unique claim existem; claim/complete ficam fora da tx cart e metadata não comporta receipt composto. | Adicionar API transaction-aware e persistência `CartMergeResult`; não copiar terminalização pós-commit. |
| Resource version | `initialize/loadForUpdate/CAS` exigem transação e `FOR UPDATE`. | Trancar versões dos dois carts em ordem estável; bump apenas em recurso estruturalmente alterado. |
| Serializer | `PublicStoreCartPreOrder` é allowlist; review ainda não existe. Middleware preserva extras do body se não forem serializados explicitamente. | Serializers fechados para envelope, review e rejected items; nunca espalhar entidade/metadata crua. |
| Manifest/OpenAPI | Attach está `DENY`/excluído; merge e acknowledge não existem; tuple BFF cobre só seis operações Cart M1. | Adicionar duas operações M1 e classificar adapter fora M1 com exclusão/depreciação explícita. |
| Data model | v1.22 já possui `GuestCartCapability`, `StoreIdempotency` e `StoreResourceVersion`, mas não merge/review. | Reconciliar nova persistência em migration futura; a afirmação antiga de ausência da capability está superada pelo snapshot atual. |

Cada linha desta tabela foi confirmada diretamente nos arquivos canônicos listados em `16-CONTEXT.md`. [VERIFIED: repository]

## Standard Stack

### Core

| Library / componente | Versão observada | Uso na phase | Diretriz |
|----------------------|-----------------|--------------|----------|
| Node.js | 22.23.1 local; projeto `>=22 <23` | Runtime e harness multiprocess | Manter a versão já fixada. [VERIFIED: `package.json`, ambiente local] |
| TypeScript | `^5.6.2` | Motor, validators, registry e testes | Manter o toolchain existente. [VERIFIED: `apps/backend/package.json`] |
| `@medusajs/framework` / `@medusajs/medusa` | `2.16.0` | Workflows e transaction manager do Cart | Usar workflows nativos com `sharedContext`; não instalar abstração concorrente. [VERIFIED: `apps/backend/package.json`] |
| PostgreSQL | cliente local 17.10 | Lock, unicidade, CAS, atomicidade e provas | Verdade exclusiva para canonicalidade/merge; Redis não participa da decisão. [VERIFIED: ambiente local e decisões D15/D16] |
| Zod | `4.2.0` | Body/params/headers estritos | Gerar schemas fechados coerentes com o registry. [VERIFIED: `apps/backend/package.json`] |
| Jest / Medusa test-utils | Jest `^29.7.0`, test-utils `2.16.0` | Unit, HTTP e PostgreSQL disposable | Estender infraestrutura existente, incluindo child processes para multiprocess. [VERIFIED: `apps/backend/package.json`, integration tests] |

### Supporting

| Componente existente | Purpose | When to Use |
|----------------------|---------|-------------|
| `GuestCartCapabilityModuleService` | Hash, lookup e lifecycle da capability | Autorizar primeira execução dentro da tx; consulta terminal restrita ao replay. |
| `StoreIdempotencyModuleService` | Key HMAC, scope/fingerprint e estados | Estender com `sharedContext`; `CartMergeResult` armazena receipt composto. |
| `StoreResourceVersionModuleService` | Versão monotônica e CAS | Trancar guest/destino e produzir ETag do snapshot retornado. |
| Workflows Medusa de cart | Add/update/transfer/invalidation | Todos os efeitos nativos devem usar o mesmo transaction manager. |
| Registry OpenAPI TypeScript | Autoridade dos contratos HTTP | Adicionar schemas/operações e gerar JSON apenas no gate de implementação. |

**Instalação:** nenhuma dependência externa nova é necessária. Não há Package Legitimacy Audit porque esta pesquisa não recomenda instalar pacote. [VERIFIED: stack existente]

## Architecture Patterns

### System Architecture Diagram

```text
Request BFF + Customer JWT + capability + Idempotency-Key + If-Match
                              |
                              v
             resolver dual-authority (sem sessão/fallback)
                              |
                   +----------+-----------+
                   | replay COMMITTED?    |
                   +----------+-----------+
                         sim / \ não
                            /   \
             receipt seguro     BEGIN PostgreSQL transaction
             + snapshot/ETag              |
                                         v
                         customer-scope advisory lock
                                         |
                           autoridade none|single|ambiguous
                              ambiguous / \ none|single
                                   409   /   \
                                       v     v
                              lock carts em ordem global
                              + rows/SRV/capability FOR UPDATE
                                       |
                                revalidar + normalizar
                                       |
                    +------------------+------------------+
                    | zero accepted    | accepted > 0     |
                    | NO_ITEMS         | merge ou attach  |
                    | receipt only     | workflows nativos|
                    +------------------+------------------+
                                       |
                      review/result/version/invalidation/
                      capability/superseding/idempotency
                                no mesmo transaction manager
                                       |
                                     COMMIT
                                       |
                         serializer allowlist + ETag do
                              mesmo snapshot transacional
```

### Recommended Project Structure

```text
apps/backend/src/
├── api/store/customers/me/cart/merge/       # endpoint canônico fino
├── api/store/carts/[id]/review/acknowledge/ # endpoint acknowledge fino
├── api/store/customers/me/cart/attach/      # adapter deprecated, sem engine próprio
├── api/store/carts/                         # validators/serializers/concurrency compartilhados
├── modules/cart-merge/                      # autoridade, result receipt, review e serviço transacional
├── modules/store-idempotency/               # operação e API sharedContext
├── modules/guest-cart-capability/           # lookup terminal restrito a replay
├── modules/store-resource-version/          # CAS existente
├── api/store-surface/                       # manifest, middleware e tuple BFF
└── api-docs/operations/store/               # registry/schemas/errors/coverage
```

Os nomes exatos são recomendação de organização, não autorização de criação. Associações a entidades core devem seguir a disciplina Medusa vigente; não acessar diretamente tabelas privadas de outro módulo. [RECOMMENDATION, confidence MEDIUM]

### Pattern 1: Autoridade Customer materializada e fail-closed

**What:** criar uma autoridade durável `CustomerCartAuthority` com `customer_id` único e `cart_id` único, usada em conjunto com advisory lock transacional de namespace próprio. Sob o lock Customer:

1. carregar a autoridade `FOR UPDATE`;
2. consultar carts Customer ativos/incompletos;
3. se não existe pointer e há zero carts, retornar `none`;
4. se não existe pointer e há exatamente um cart, materializar o pointer na mesma transação;
5. se não existe pointer e há mais de um, retornar `ambiguous` e 409;
6. se o pointer é inválido ou contradiz o conjunto utilizável, falhar fechado;
7. obrigar todo path que cria, promove ou reassocia Customer cart — pelo menos `POST active`, merge e attach-adapter — a adquirir o mesmo lock.

**Why:** apenas travar guest e destino não evita um phantom: outro processo pode criar um novo Customer cart depois da seleção. A seleção atual por `updated_at` e seu teste correspondente são incompatíveis com D16-06. [VERIFIED: `customer-active-cart.ts`; `active/route.ts`; `customer-cart-active.spec.ts`]

**Alternative rejeitada:** contar candidatos sem pointer durável reduz o gap, mas não materializa qual cart continua sendo a autoridade entre requests; uma partial unique em metadata/tabela core não é compatível com isolamento de módulos nem cobre o fluxo legado com segurança. [RECOMMENDATION, confidence MEDIUM]

### Pattern 2: Ordem global de locks

**What:** usar a seguinte ordem em toda operação multi-cart:

1. advisory xact lock de Customer (`namespace Phase16 + customerId`);
2. resolver `none|single|ambiguous`;
3. advisory xact locks dos carts afetados ordenados lexicalmente por `cart_id`;
4. rows core/cart projection e `StoreResourceVersion` `FOR UPDATE` na mesma ordem;
5. capability row do guest;
6. idempotency claim/result/review rows;
7. reconsulta final de ownership, active/completed, linhas e versões antes de decidir.

O lock de Customer serializa merges e criação/associação; os locks de cart serializam merge contra mutações guest/Customer já existentes. O helper da capability atualmente usa cart advisory lock antes da capability row, portanto o merge deve preservar essa ordem e nunca tomar capability primeiro. [VERIFIED: `guest-cart-capability/service.ts`; `line-item-mutation.ts`; `payment-attempt/transactional-authority.ts`]

### Pattern 3: Um transaction manager, um commit visível

**What:** iniciar a transação pelo módulo Cart e encaminhar o mesmo `sharedContext` a workflows, SRV, capability, idempotency e módulo de merge. A sequência lógica para `MERGED`/`MERGED_PARTIAL` é:

1. validar/classificar sem write;
2. aplicar add/update nativo à quantidade final, uma linha por variante;
3. invalidar shipping/payment/cart-dependent state no mesmo contexto;
4. gravar `CartMergeResult` e, se partial, `CartReview`;
5. aplicar bumps exatos de versões dos carts alterados;
6. associar/superseder/inativar o guest conforme outcome;
7. consumir a capability;
8. terminalizar a idempotência como `COMMITTED`;
9. capturar cart + versão + review dentro da transação;
10. COMMIT; só então emitir a resposta.

Qualquer throw antes do COMMIT deve reverter todos os writes. A implementação atual de line item terminaliza idempotência depois do commit e entra em reconciliation se falhar; esse desenho não satisfaz D16-29/36 para merge. [VERIFIED: `line-item-mutation.ts`; `store-idempotency/service.ts`]

### Pattern 4: Motor por matriz de outcome

| Estado sob lock | accepted total | rejected total | Outcome | Efeitos confirmados |
|-----------------|----------------|----------------|---------|---------------------|
| 1 destino Customer | `>0` | `0` | `MERGED` | Customer recebe aceitos; guest superseded; capability consumed; versions correspondentes avançam; sem review. |
| 1 destino Customer | `>0` | `>0` | `MERGED_PARTIAL` | Mesmos efeitos + review pendente persistida no Customer. |
| 0 destinos | `>0` | qualquer permitido | `GUEST_CART_ATTACHED` | O mesmo guest é associado ao Customer e vira canônico; não criar cart de cópia; capability consumed. Se houver rejeição com aceite parcial, esta combinação precisa ser tratada como `MERGED_PARTIAL`, não esconder divergência aplicada. |
| 0 ou 1 destino | `0` | `>=0` | `NO_ITEMS` | Nenhum cart/version/review/capability muda; só receipt idempotente pode ser confirmado. |
| >1 sem autoridade | — | — | erro 409 | Zero efeito. |
| regra de preservação aprovada | `0` | — | `CUSTOMER_CART_PRESERVED` | **Nenhuma regra existe; branch não deve ser implementado.** |

O caso “0 destinos + alguns aceitos e alguns rejeitados” revela uma tensão entre D16-04 (`GUEST_CART_ATTACHED`) e D16-16/17 (`MERGED_PARTIAL` sempre que divergência foi aplicada). A leitura conservadora é priorizar `MERGED_PARTIAL` quando houve aplicação parcial, mas essa precedência precisa de confirmação humana antes do PLAN; não inventar um sexto outcome. [INFERENCE from D16-04, D16-16, D16-17; confidence MEDIUM]

## Persistência Recomendada

### `CustomerCartAuthority`

| Campo lógico | Regra |
|--------------|-------|
| `customer_id` | único, não público; identidade Customer autoritativa |
| `cart_id` | único; referência ao cart core via link/ID conforme padrão Medusa |
| `state` | `active|superseded`, enum interno fechado |
| timestamps | internos, nunca serializados no contrato Store |

Constraints físicas mínimas: unique ativo por Customer, unique ativo por cart e validação transacional contra carts ativos/incompletos. Backfill deve falhar e produzir evidência sanitizada quando encontrar `>1`; nunca escolher por timestamp. [RECOMMENDATION, confidence MEDIUM]

### `CartMergeResult` — receipt imutável

| Campo lógico | Regra |
|--------------|-------|
| `id` | ID interno, usado como `StoreIdempotency.result_id` |
| `idempotency_record_id` | unique 1:1 |
| `customer_id` | binding interno da identidade autenticada |
| `guest_cart_id` / `customer_cart_id` | origem e destino (`null` na promoção) |
| `canonical_cart_id` | cart resultante |
| `capability_id` e/ou `token_hash` | referência segura; nunca capability plaintext |
| `request_fingerprint` | digest SHA-256, não o objeto secreto/bruto |
| `guest_version_before`, `customer_version_before` | contexto autoritativo do fingerprint |
| `guest_version_after`, `canonical_version_after` | prova do commit |
| `outcome` | enum exato dos cinco outcomes; o reservado não ganha branch fictício |
| `rejected_items` | JSONB fechado, já normalizado e sem catálogo/PII |
| `review_id` / `review_ref` | nullable; presente somente em partial |
| `response_receipt` | projeção mínima allowlisted necessária ao replay, com retenção igual à idempotência |

Não armazenar JWT, raw `Idempotency-Key`, raw capability, headers, entidade Cart crua, metadata irrestrita ou payload completo. A metadata atual de `StoreIdempotency` aceita apenas chaves/valores escalares allowlisted, então o receipt composto deve morar no módulo de merge, não ser espremido na metadata. [VERIFIED: `store-idempotency/service.ts`]

### `CartReview`

| Campo lógico | Regra |
|--------------|-------|
| `id` | interno |
| `cart_id` | cart Customer resultante |
| `review_ref` | CSPRNG opaco, público, unique, não derivado de cart/customer/versão |
| `merge_result_id` | unique; origem imutável da revisão |
| `produced_cart_version` | versão exata do `MERGED_PARTIAL` |
| `status` | `pending|acknowledged|superseded`, interno |
| `rejected_items` | snapshot público mínimo fechado |
| internal timestamps/actor | permitidos só internamente, proibidos no serializer |

Criar unique parcial “no máximo uma `pending` por cart”. `requiresReview` é derivado de `status=pending`; não duplicar boolean em `Cart.metadata`. A função atual que marca cart superseded reconstrói uma allowlist de metadata de ownership, mostrando que metadata genérica não é base segura para review. [VERIFIED: `apps/backend/src/modules/checkout/active-cart.ts`]

### Semântica de mutação posterior

D16-26 torna o acknowledge da versão antiga inaplicável e diz que review não reaparece automaticamente. A implementação física mais coerente é fazer toda mutação estrutural posterior, dentro do mesmo CAS, marcar a revisão `pending` anterior como `superseded`; a projeção pública passa a `false/null/[]`, o `reviewRef` antigo com versão atual resulta 409 e com `If-Match` antigo resulta 412. Um novo `MERGED_PARTIAL` cria nova revisão. Isso exige integrar um hook de invalidation de review no pipeline compartilhado de line-item mutation e em toda futura mutação estrutural. [RECOMMENDATION, confidence MEDIUM]

Esta interpretação deve receber decisão humana explícita porque D16-22 também diz que um mismatch mantém `requiresReview=true`; o texto não define diretamente qual evento limpa uma review pendente quando o cart muda. Até essa decisão, o PLAN não deve inventar bloqueio de mutações nem manter review eternamente inaplicável. [OPEN DECISION]

## Fingerprint Físico e Replay

### Binding da chave

O raw `Idempotency-Key` continua sendo persistido somente como:

```text
key_hash = HMAC-SHA-256(STORE_IDEMPOTENCY_PEPPER, rawKey)
```

O fingerprint usa o canonicalizador já existente, depois de ordenar explicitamente o array de intenção por `variantId` (o canonicalizador ordena chaves de objetos, mas preserva a ordem de arrays):

```json
{
  "operation": "CART_MERGE",
  "customerId": "cus_...",
  "guestCartId": "cart_guest",
  "customerCartId": "cart_customer_or_null",
  "guestVersion": 7,
  "customerVersion": 11,
  "normalizedGuestIntent": [
    { "variantId": "variant_public", "quantity": 3 }
  ]
}
```

`customerVersion` é `null` quando `customerCartId=null`. A capability não aparece em plaintext; `actor_scope_hash`/`resource_scope_hash` e o result vinculam `customerId`, guest, capability record/hash seguro e operação. [VERIFIED: D16-27..32 e `store-idempotency/service.ts`]

### Precondition física

Recomendação: o `If-Match` do merge representa a versão do **guest source**, que é o recurso explicitamente apresentado no request. O destino não é aceito do cliente: ele é resolvido, travado e sua versão atual entra no fingerprint sob autoridade do servidor. Isso evita um segundo header ou um ETag composto incompatível com o parser inteiro vigente. Após a serialização, o motor recalcula a aceitação contra a versão Customer travada, portanto não há lost update; mudança concorrente do Customer é observada antes da decisão. [RECOMMENDATION, confidence MEDIUM; verified parser: `apps/backend/src/api/store/carts/concurrency.ts`]

Um PLAN posterior deve documentar essa escolha no OpenAPI. Se a revisão humana exigir optimistic precondition também do destino, será necessário um contrato novo explícito (por exemplo, body `customerCartVersion`) e um parser novo; não sobrecarregar silenciosamente o ETag simples existente. [OPEN DECISION]

### Algoritmo de primeira execução versus replay

```text
1. Sempre validar BFF e Customer JWT.
2. Hash da capability apresentada; nunca logar/persistir o token.
3. Buscar claim/result por operation + customer + key_hash + guest/capability scope.
4. Se COMMITTED e bindings coincidem: replay; não exigir capability ACTIVE.
5. Se key existe com binding/fingerprint incompatível: 409, zero efeito.
6. Sem COMMITTED: capability precisa estar ACTIVE; preflight touch=false.
7. Entrar na transação, adquirir locks e recomputar o fingerprint autoritativo.
8. Claim, mutações e terminalização ocorrem na mesma transação.
9. Capability consumed só aceita no passo 4; nunca autoriza passos 6–8.
```

O lookup genérico ativo não serve para o passo 4 porque rejeita capability consumed. É necessária consulta específica, constant-time/hash-based, que só revela existência após BFF+Customer e key/scope compatíveis, sem touch/rolling TTL. [VERIFIED: `guest-cart-capability/service.ts`; RECOMMENDATION, confidence HIGH]

### Replay após acknowledge ou mutação posterior

Recomendação: `CartMergeResult` preserva o **receipt original** (`outcome`, rejected items, `reviewRef`, versões e cart canônico), enquanto o replay captura o cart atual + ETag atual no mesmo snapshot transacional. O envelope precisa declarar documentalmente que `outcome/review` descrevem a operação original e que `cart/ETag` são atuais; efeitos jamais são reaplicados. Isso obedece a alternativa explicitamente permitida por D16-33 sem duplicar endereços/e-mail do cart num snapshot persistido. [RECOMMENDATION, confidence MEDIUM]

Há um trade-off contratual: após ACK de um partial, o receipt original ainda tem `requiresReview=true`, enquanto o estado atual está limpo. Para evitar ambiguidade no consumidor, a recomendação mais segura é devolver `review` **atual** e acrescentar um bloco fechado `mergeReceipt` com outcome/rejected/reviewRef originais; porém D16-19 ainda não aprovou esse campo. Se o contrato permanecer estritamente `{outcome, cart, review}`, então deve-se escolher entre snapshot original completo ou review original potencialmente stale. Essa é decisão humana necessária antes do PLAN. [OPEN DECISION]

Alternativa rejeitada: reconstruir tudo pelo cart atual e perder outcome/rejected items originais viola D16-29/33. Alternativa rejeitada: persistir entidade Cart/response inteira duplica PII e cria retenção/desatualização desnecessárias. [RECOMMENDATION, confidence HIGH]

## Contrato Técnico dos Endpoints

### `POST /store/customers/me/cart/merge`

**Security obrigatória:** `x-indicio-bff-auth`, publishable key, `Authorization: Bearer <Customer JWT>`, `x-indicio-guest-cart-token`, `Idempotency-Key` e `If-Match`; correlation ID permanece opcional. Não aceitar `customerSession` e não reutilizar `resolveM1CartActor`, pois esse helper escolhe guest por precedência em vez de autenticar Customer e guest simultaneamente. [VERIFIED: `active-cart.ts`; D16-30/31/38]

**Body Zod/OpenAPI recomendado, strict/additionalProperties=false:**

```json
{ "guestCartId": "cart_..." }
```

`guestCartId` é binding explícito, não autoridade: deve coincidir com o cart vinculado à capability. O destino Customer nunca é escolhido pelo request. `If-Match` liga a versão guest; a versão destino é lida sob lock. [RECOMMENDATION, confidence MEDIUM]

**200 recomendado:**

```json
{
  "outcome": "MERGED_PARTIAL",
  "cart": {},
  "review": {
    "requiresReview": true,
    "reviewRef": "opaque-public-ref",
    "rejectedItems": [
      {
        "variantId": "variant_public",
        "requestedQuantity": 30,
        "acceptedQuantity": 19,
        "rejectedQuantity": 11,
        "reason": "QUANTITY_LIMIT_EXCEEDED"
      }
    ]
  }
}
```

`outcome` enum contém exatamente os cinco literais de D16-02, mas não há código positivo para `CUSTOMER_CART_PRESERVED`. O header `ETag` corresponde ao cart canônico serializado. `Cache-Control: no-store`. O serializer de cada objeto é allowlist; nenhum hash, capability, Customer interno, timestamp, provider ID, metadata ou mensagem técnica atravessa. [RECOMMENDATION, confidence HIGH]

**Efeitos por outcome:**

- `MERGED`: destino Customer atualizado, guest superseded/inativo, capability consumed, receipt committed, sem review.
- `MERGED_PARTIAL`: mesmos efeitos, mais `CartReview.pending` e rejected items fechados.
- `GUEST_CART_ATTACHED`: quando não há destino e todo conteúdo elegível pode ser preservado, o mesmo guest é associado ao Customer; nenhuma cópia/cart novo.
- `NO_ITEMS`: nenhum cart/version/capability/review muda; receipt idempotente pode registrar a tentativa.
- `CUSTOMER_CART_PRESERVED`: reservado e inalcançável até regra humana aprovada.

### `POST /store/carts/{id}/review/acknowledge`

**Security:** BFF + publishable key + Customer bearer. Capability guest não se aplica. `If-Match` é obrigatório. Recomenda-se `Idempotency-Key` para manter POST retries observáveis, mas a idempotência de domínio continua garantida pelo `reviewRef`/status mesmo com keys distintas. [RECOMMENDATION, confidence MEDIUM]

**Body recomendado:** `{ "reviewRef": "string-or-null" }`, strict. `null` é a forma explícita de pedir o no-op D16-24 quando não há review pendente; uma string deve corresponder à pending atual ou a uma review já acknowledged do mesmo cart. Um ref desconhecido/foreign nunca vira no-op. Se a revisão humana preferir `reviewRef` sempre obrigatório, D16-24 precisa definir qual ref representa “sem revisão”; não aceitar ausência ambígua. [OPEN DECISION]

**Semântica sob transação:** customer lock → cart lock → SRV row → review row. Revalidar que `{id}` é o cart Customer canônico. Pending + ref correto + `If-Match` da versão produzida: marcar acknowledged, retornar review `false/null/[]`, sem bump SRV. Mesmo ref já acknowledged: 200 com cart atual/review false, sem efeito. Sem pending + `null`: 200 no-op. Ref divergente: 409. Versão stale: 412 e nenhum efeito. [RECOMMENDATION, confidence HIGH]

**200:** `{ "cart": PublicStoreCartPreOrder, "review": CartReviewState }` + ETag da versão atual capturada com o cart. Como acknowledge muda estado público sem bump estrutural por D16-23, a resposta deve ser `Cache-Control: no-store`; ETag continua sendo versão estrutural do cart, não hash de todo o envelope. [RECOMMENDATION, confidence HIGH]

### `/store/customers/me/cart/attach` deprecated, fora do M1

- Continuar fora do exact-set Store M1 e do OpenAPI executável; manter exclusão explícita com reason, owner Phase 16 e gatilho de remoção/revisão.
- Reclassificar no manifest como rota preservada/deprecated controlada, **não** habilitá-la como sétima operação M1.
- Exigir exatamente a mesma segurança, headers, body, validator, idempotency operation, serializer e motor do merge.
- Request apenas de sessão/legado retorna erro estável de depreciação/migração com zero efeito.
- Quando elegível, retornar os mesmos cinco outcomes e review; não preservar `attached_guest_cart`, `preserve_customer_cart` nem `buildAttachGuestCartDecision` como autoridade.
- Continuar negando o attach nativo `/store/carts/{id}/customer`.

O manifest atual classifica attach como `DENY` e a cobertura o exclui; isso fornece o ponto de partida seguro para o adapter, mas não sua semântica futura. [VERIFIED: `store-surface/manifest.ts`; `api-docs/coverage/exclusions.ts`; `attach-guest-cart.ts`]

## Mapeamento HTTP Proposto

| HTTP | Código público / condição | Snapshot/efeito |
|------|---------------------------|-----------------|
| 200 | Um dos outcomes fechados; acknowledge aplicado/no-op; same-key replay elegível | Body e ETag coerentes; replay nunca reaplica efeito. |
| 400 | Body/header ausente ou malformado, `guestCartId` ausente, `If-Match` inválido | Zero efeito. Não usar para versão stale bem formada. |
| 401 | Customer JWT ausente/inválido/expirado | Zero efeito; padrão auth existente. |
| 404 | Capability inválida/expirada/revogada/foreign e sem replay elegível; cart/review alheio | Resposta não enumerável, zero IDs internos. |
| 409 | Canonicalidade ambígua; key/fingerprint incompatível ou in-progress; capability consumed por outra key/intenção; concorrente de key diferente perdeu; `reviewRef` divergente/inaplicável | Zero efeito; nunca mapear para `CUSTOMER_CART_PRESERVED`. |
| 412 | Exclusivamente `If-Match` stale no guest source ou no cart do acknowledge | `CART_VERSION_MISMATCH`; quando seguro, cart allowlisted + ETag atual do mesmo snapshot. |
| 503 | Autoridade Customer/auth/PostgreSQL indisponível segundo padrão existente | Fail-closed, zero efeito. |
| 500 | Falha técnica inesperada com rollback | Envelope sanitizado, zero estado parcial. |

Rejeição de variante, indisponibilidade e overflow não são 409/412/422: são decisões por item que compõem `MERGED_PARTIAL` ou `NO_ITEMS`. [VERIFIED: D16-09..18]

## Integração com Serviços Existentes

### GuestCartCapability

- Criar um resolver dual-authority; não usar o XOR guest/Customer do ator Cart M1.
- Preflight de primeira execução com `touch:false`; reautorizar e, se necessário, renovar dentro da transação.
- Manter ordem cart advisory lock → capability row lock.
- Consumir/revogar com o mesmo `sharedContext`; rollback restaura ACTIVE.
- Criar leitura terminal restrita ao replay, indexada por hash/record seguro, que não reativa nem toca TTL.
- `NO_ITEMS` e `CUSTOMER_CART_PRESERVED` não consomem.

### StoreIdempotency

- Adicionar operação própria `CART_MERGE`; não reutilizar CheckoutCompletionLog ou operação de line item.
- Expor `claim/load/complete/fail` que aceitem o transaction manager da operação; unique claim e terminal state devem confirmar com o cart.
- Vincular `result_id` a `CartMergeResult`; manter metadata pequena e allowlisted.
- Same-key COMMITTED decide replay antes de exigir capability ACTIVE, mas depois de BFF+Customer e binding seguro.
- `NO_ITEMS` pode terminar COMMITTED para que retry não reavalie catálogo/intent e mude outcome sem nova key.
- Acknowledge pode ter operação própria se `Idempotency-Key` for aprovado; seu no-op natural por review status continua obrigatório.

### StoreResourceVersion / ETag / If-Match

- Carregar SRV de guest e destino `FOR UPDATE` em ordem de cart ID.
- Merge com destino avança destino exatamente uma vez e guest quando o guest é estruturalmente superseded; promoção avança o mesmo guest uma vez; `NO_ITEMS` zero bumps.
- Acknowledge válido/no-op zero bumps.
- Toda mutação estrutural deve tratar review pendente conforme a decisão D16-26 e fazer isso no mesmo CAS.
- Capturar cart, review e versão dentro da tx; serializar ETag dessa versão, sem refetch tardio.

### Line-item mutation e workflows Medusa

- Reusar transactional module proxy, invalidation e snapshot seams do pipeline Phase 15.
- Não invocar workflows fora da transação nem em três commits separados como o attach atual.
- Normalizar guest e Customer por `variantId`; atualizar linha Customer existente ou adicionar uma única linha final, nunca copiar linhas físicas duplicadas.
- Revalidar variant existence/availability no snapshot da operação e classificar reason code fechado; exceção técnica continua rollback, não rejected item.
- Integrar superseding de review em todo path estrutural, se a recomendação de D16-26 for aprovada.

## Impacto Provável de Arquivos em um PLAN Posterior

Esta lista orienta escopo; não autoriza alteração neste gate.

| Área | Arquivos existentes / novos prováveis | Responsabilidade |
|------|----------------------------------------|------------------|
| Motor e persistence | `src/modules/cart-merge/**`, module registration e migrations futuras | Authority, result receipt, review, workflow/service transacional. |
| Merge route | `src/api/store/customers/me/cart/merge/route.ts` e validator/middleware | Endpoint fino e dual-authority. |
| Acknowledge route | `src/api/store/carts/[id]/review/acknowledge/route.ts` | CAS/ref/status idempotente. |
| Adapter | `src/api/store/customers/me/cart/attach/route.ts`, `src/modules/checkout/attach-guest-cart.ts` | Delegação ao motor; erro de sessão legado. |
| Active authority | `src/api/store/carts/customer-active-cart.ts`, `active/route.ts` | Resultado discriminado, Customer lock/pointer. |
| Cart mutation | `src/api/store/carts/line-item-mutation.ts` | Hook de review em mutação estrutural, mesma tx. |
| Capability | `src/modules/guest-cart-capability/service.ts`, types | Lookup terminal replay-only e transaction context. |
| Idempotency | `src/modules/store-idempotency/operations.ts`, service/model | `CART_MERGE`, sharedContext e result link. |
| Serialization | `src/api/store/carts/serializers.ts` e schemas DTO | Allowlist de merge/review/rejected item. |
| Surface/security | `src/api/store-surface/manifest.ts`, BFF protected operations, middlewares | Duas operações M1; adapter deprecated fora M1; auth tuple exata. |
| OpenAPI | `src/api-docs/operations/store/carts.ts`, schemas, parameters, errors, security, coverage/exclusions | Contrato canônico e depreciação explícita. |
| HTTP tests | `integration-tests/http/cart-merge-review.spec.ts` e suites cart existentes | Matriz de endpoints, segurança, replay e adapter. |
| Module/PG tests | `integration-tests/modules/*cart-merge*.postgres.spec.ts` | Locks, rollback, multiprocess, versões e rows reais. |
| Invariants | `guest-cart-order-invariants.postgres.spec.ts`, leakage helper/suites | Zero Order e zero leakage em todos os sinks. |
| Docs de dados | `docs/DB_MODEL_v1.22.md` ou próximo snapshot aprovado | Registrar modelos somente quando migration/schema forem autorizados. |

O registry TypeScript deve ser alterado antes do JSON gerado. O fluxo futuro é: gerar a surface Store, revisar diff, lintar e, em checkout limpo posterior, executar `openapi:check` read-only. [VERIFIED: API Docs Contract em `AGENTS.md`]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Exclusão mútua | Mutex em memória/Redis | PostgreSQL advisory xact locks + row locks | Precisa funcionar em processos distintos e compartilhar o commit. |
| Concorrência otimista | Contador em metadata | `StoreResourceVersion` e CAS existentes | Já define ETag/If-Match server-authoritative. |
| Hash de secrets | Hash sem pepper ou raw key | HMAC/SHA-256 existentes e CSPRNG do módulo capability | Evita plaintext e mantém identidade estável segura. |
| Mutação de cart | SQL direto em tabelas Medusa | Workflows nativos com transactional proxy | Preserva regras/invalidation do framework. |
| Review | Boolean solto em Cart metadata | `CartReview` constrained/versioned | Metadata não garante unicidade, estado ou ack exato. |
| Replay | Refazer merge ou reconstruir pelo cart atual | `CartMergeResult` imutável + claim transacional | Evita double effect e preserva outcome original. |
| Canonicalidade | `updated_at DESC`, sessão ou cache | Authority Customer durável sob lock PG | Timestamp não é autoridade e Redis/sessão não fecham races. |
| Contrato HTTP | Entidade spread / JSON OpenAPI manual | Serializers allowlist + registry TypeScript/Zod | Evita leakage e drift. |

**Key insight:** a complexidade não está em somar quantidades; está em fazer seleção, autorização, mutação, review, versionamento, consumption e receipt terem a mesma fronteira de commit.

## Anti-Patterns e Common Pitfalls

### Pitfall 1: Selecionar “o mais recente”

**What goes wrong:** duas sessões/processos podem criar carts concorrentes e o merge escolhe arbitrariamente.
**Why:** `updated_at` é dado mutável, não constraint.
**Avoid:** Customer lock + authority row + resultado `ambiguous`.
**Warning sign:** teste que espera “newer cart wins”. [VERIFIED: `customer-cart-active.spec.ts`]

### Pitfall 2: Claim fora e complete depois da transação

**What goes wrong:** cart/capability confirmam, mas receipt não; retry pode reaplicar ou cair em reconciliation.
**Why:** copiar o pipeline Phase 15 sem considerar D16-31/36.
**Avoid:** claim/result/terminal state no mesmo manager do Cart. [VERIFIED: `line-item-mutation.ts`; `store-idempotency/service.ts`]

### Pitfall 3: Validar capability apenas antes do lock

**What goes wrong:** capability muda entre preflight e commit ou rolling TTL é tocado por um request que não executará.
**Avoid:** preflight sem touch e reautorização sob cart lock; replay terminal sem touch. [VERIFIED: `guest-cart-capability/service.ts`]

### Pitfall 4: Lock inversion multi-cart

**What goes wrong:** merge A trava guest→Customer e merge B trava Customer→guest, causando deadlock.
**Avoid:** Customer scope primeiro e cart IDs sempre ordenados; nenhum path toma capability antes do cart.

### Pitfall 5: Confundir rejected item com erro técnico

**What goes wrong:** timeout/DB/provider failure vira `VARIANT_UNAVAILABLE`, confirma merge parcial indevido e esconde rollback.
**Avoid:** only deterministic domain checks produce closed reason codes; exceções técnicas abortam.

### Pitfall 6: Duplicar linhas físicas

**What goes wrong:** guest com linhas duplicadas gera duas decisões ou duas linhas Customer; replay duplica quantidade.
**Avoid:** agregar por variant, ordenar e emitir uma decisão/write por variante. Falhar fechado se uma linha não tiver `variantId` público seguro até regra aprovada.

### Pitfall 7: Retornar body e ETag de leituras diferentes

**What goes wrong:** resposta contém cart vN+1 e header vN; o próximo CAS falha sem causa aparente.
**Avoid:** snapshot cart/review/version ainda dentro da tx, antes do commit response. [VERIFIED: `guest-cart-mutation-snapshot-concurrency.spec.ts`]

### Pitfall 8: Tornar `CUSTOMER_CART_PRESERVED` um catch-all

**What goes wrong:** ambiguidade, erro, `NO_ITEMS` ou conflito parecem sucesso.
**Avoid:** enum no contrato, zero branch/fixture positiva; erro permanece erro até regra humana.

### Pitfall 9: Review duplicada ou presa

**What goes wrong:** boolean em metadata diverge do ref/version, ou mutação posterior deixa ref impossível de reconhecer.
**Avoid:** state machine constrained, unique pending e decisão explícita para D16-26 antes do PLAN.

### Pitfall 10: Adapter mantém bypass legado

**What goes wrong:** rota canônica é segura, mas sessão antiga ainda promove carts sem capability/CAS/idempotência.
**Avoid:** mesma função, validators e operação idempotente; request legado é erro zero-effect. [VERIFIED: attach atual]

## Runtime State Inventory

Esta phase substitui/deprecia comportamento existente e cria nova persistência; portanto o inventário de estado runtime é aplicável.

| Category | Items Found | Action Required no PLAN posterior |
|----------|-------------|------------------------------------|
| Stored data | Carts Customer/guest, ownership metadata, `GuestCartCapability`, `StoreIdempotency` e `StoreResourceVersion` já existem; não há `CustomerCartAuthority`, `CartMergeResult` ou `CartReview`. | Migration local/futura; auditoria/backfill sanitizado deve falhar em Customers com >1 candidato, sem escolher. Nenhuma DB remota foi acessada. |
| Live service config | Nenhuma configuração externa específica de merge/review foi encontrada no repositório; Redis não será autoridade. | None — verificado apenas em config versionada; serviços reais não foram inspecionados por proibição do gate. |
| OS-registered state | Nenhum nome/registro de serviço OS é alterado por esta phase. | None — mudança é backend/data contract, sem deploy/process manager. |
| Secrets/env vars | Peppers existentes de capability/idempotência continuam; nenhuma nova secret é necessária para `reviewRef` CSPRNG. | Não renomear/rotacionar neste gate; revisar somente se o design final exigir retention/pepper novo. |
| Build artifacts / installed packages | JSON OpenAPI gerado refletirá mudanças futuras; nenhum pacote novo é necessário. | Writer somente durante implementação autorizada; `openapi:check` final read-only em worktree limpo. |

## State of the Art no Repositório

| Current/Old Approach | Recommended Phase 16 Approach | Impact |
|----------------------|-------------------------------|--------|
| Attach promove guest e supersede Customer em workflows separados | Merge transacional Customer-as-destination ou promoção do mesmo guest | Elimina semântica paralela e partial commits. |
| Customer cart mais recente vence | Authority materializada + ambiguity 409 | Fail-closed e multiprocess-safe. |
| Idempotency completion pós-commit | Claim/result/completion no mesmo transaction manager | Replay pós-consumo sem reconciliation gap. |
| Idempotency replay refaz fetch atual | Receipt original + política explícita de snapshot atual/original | Outcome não é perdido após mudanças. |
| Cart serializer apenas | Envelope/review/rejected serializers fechados | Capability leakage ZERO. |
| Attach DENY/excluded | Adapter deprecated, controlado e fora M1 | Migração sem bypass e sem remoção silenciosa. |

## Code Examples

Pseudocódigo prescritivo; nomes finais dependem do PLAN autorizado.

### Seleção fail-closed sob autoridade Customer

```typescript
// Source pattern: repository customer-active-cart.ts + PG authority seams
type CanonicalCustomerCart =
  | { kind: "none" }
  | { kind: "single"; cartId: string }
  | { kind: "ambiguous" }

await lockCustomerScope(customerId, sharedContext)
const authority = await loadAuthorityForUpdate(customerId, sharedContext)
const candidates = await listUsableCustomerCarts(customerId, sharedContext)

if (!authority && candidates.length > 1) return { kind: "ambiguous" }
// Nunca usar updated_at para decidir.
```

### Normalização/fingerprint determinísticos

```typescript
// Source pattern: repository store-idempotency/service.ts canonicalizer
const normalizedGuestIntent = [...aggregateByVariant(guestLines).entries()]
  .map(([variantId, quantity]) => ({ variantId, quantity }))
  .sort((a, b) => a.variantId.localeCompare(b.variantId))

const fingerprint = fingerprintRequest({
  operation: "CART_MERGE",
  customerId,
  guestCartId,
  customerCartId: destination?.id ?? null,
  guestVersion,
  customerVersion: destinationVersion ?? null,
  normalizedGuestIntent,
})
```

### Atomicidade da capability

```typescript
// Source pattern: repository line-item-mutation.ts + capability sharedContext
await cartModule.transaction(async (manager) => {
  const sharedContext = { transactionManager: manager }
  await lockAndRevalidateAll(sharedContext)
  await applyNativeCartWorkflows(sharedContext)
  await persistResultAndReview(sharedContext)
  await advanceAffectedVersions(sharedContext)
  await consumeCapability(sharedContext) // visível somente se COMMIT ocorrer
  await completeIdempotency(sharedContext)
  responseSnapshot = await captureCartReviewVersion(sharedContext)
})
```

## Validation Architecture

`workflow.nyquist_validation=true`; a validação deve ser planejada, mas nenhum teste técnico foi executado neste gate. [VERIFIED: `.planning/config.json`]

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest `^29.7.0` + `@medusajs/test-utils` `2.16.0` |
| Config file | `apps/backend/jest.config.js` |
| Quick run command | `cd apps/backend && npm run test:unit -- --runTestsByPath <phase-unit-file>` |
| HTTP command | `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/cart-merge-review.spec.ts` |
| PG command | `cd apps/backend && npm run test:integration:modules -- --runTestsByPath integration-tests/modules/cart-merge-review.postgres.spec.ts` |
| Full suite command | scripts `test:unit`, `test:integration:http`, `test:integration:modules` + OpenAPI lint/check conforme gate |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| MRG-01 | Merge autenticado, atômico, idempotente | HTTP + PG | `npm run test:integration:http -- --runTestsByPath integration-tests/http/cart-merge-review.spec.ts` | ❌ Wave 0 |
| MRG-02 | Enum/outcome matrix exata | unit + HTTP | `npm run test:unit -- --runTestsByPath src/modules/cart-merge/__tests__/decision.unit.spec.ts` | ❌ Wave 0 |
| MRG-03 | Agregação/teto 99/retry | unit + PG | mesmo unit + module PG | ❌ Wave 0 |
| MRG-04 | Rejeição localizada e partial | unit + HTTP | mesmo unit + HTTP | ❌ Wave 0 |
| MRG-05 | Rollback/consume/supersede atômicos | PG failpoints | `npm run test:integration:modules -- --runTestsByPath integration-tests/modules/cart-merge-review.postgres.spec.ts` | ❌ Wave 0 |
| MRG-06 | Review persistida e ack versionado | HTTP + PG | HTTP/PG Phase 16 | ❌ Wave 0 |
| MRG-07 | Review guard + acknowledge idempotente | unit + HTTP | HTTP Phase 16 + guard unit | ❌ Wave 0 |
| MRG-08 | Adapter paritário, sessão negada | HTTP + manifest/OpenAPI unit | HTTP Phase 16 + `store-contract.unit.spec.ts` | Parcial; novos casos ❌ |

### Provas Obrigatórias

#### 1. Zero Order birth

Estender `guest-cart-order-invariants.postgres.spec.ts`: contar `Order` real antes/depois de cada outcome alcançável, merge replay, acknowledge aplicado/no-op, attach adapter, conflito, race e rollback. O único controle positivo continua sendo o fluxo canônico `payment_intent.succeeded`; nenhum fixture Order in-memory substitui a contagem PostgreSQL/Medusa. [VERIFIED: suite existente]

#### 2. Capability leakage ZERO

Reusar o helper de oito sinks e canários distintos para capability, JWT e raw `Idempotency-Key`. Inspecionar response body/headers, errors, DB/JSON result/review/idempotency, Redis local quando harness usar, logs, Sentry capture, OpenAPI/examples/snapshots, analytics e outgoing provider mocks. A capability pode existir apenas no header de request em memória; fingerprint, ETag e `reviewRef` não podem codificá-la. [VERIFIED: `integration-tests/helpers/guest-cart-leakage.ts`; D16-30/32]

#### 3. Replay sem double effect

- same key immediate e depois da capability consumed;
- same key depois de ACK e depois de cart v+1, conforme política de replay aprovada;
- mesma key + guest/body/customer/fingerprint diferente → 409;
- key diferente depois da vencedora → 409, não replay;
- contagem exata de workflows, linhas/quantidades, version bumps, review rows, consume e superseding;
- nenhuma reconstrução do fingerprint a partir do estado pós-commit.

#### 4. Rollback completo

Em PostgreSQL disposable, injetar falha depois de cada write relevante: line items, invalidation, result, review, version CAS, association/supersede, consume e idempotency completion, ainda antes do COMMIT. Após cada falha: carts/lines/versions iguais ao baseline, zero review/result COMMITTED, capability ACTIVE, guest ativo, idempotency não terminal utilizável e Orders=0. Registrar txid/manager comum como as provas transacionais existentes. [VERIFIED: `store-resource-version.postgres.spec.ts`; `store-foundation-transaction-compatibility.spec.ts`]

#### 5. Concorrência multiprocess/PostgreSQL

Usar dois child processes Node com PIDs/conexões distintas e a mesma DB disposable, padrão já existente em `auth-multiprocess.spec.ts`. Cobrir same-key, keys diferentes, merge vs guest mutation, merge vs Customer mutation e merge vs `POST active`. Provar um efeito, uma linha por variante, quantidades finais corretas, bumps exatos, uma review partial, uma terminalização de capability/guest e Orders=0. Redis deve estar desligado ou explicitamente não autoritativo na prova. [VERIFIED: harness multiprocess existente]

#### 6. Body + ETag do mesmo snapshot

Evoluir o teste discriminante de Phase 15 com barreira: A captura cart/review/version dentro da tx; B só avança após o lock. A deve retornar body vN + ETag N; B retorna seu snapshot coerente ou conflito/412. Proibir `remoteQuery`/refetch tardio como fonte do header. [VERIFIED: `guest-cart-mutation-snapshot-concurrency.spec.ts`]

#### 7. Contrato/segurança

- Zod strict ↔ registry equivalentes;
- capability parameter obrigatório somente no merge/adapter, não alterar o parâmetro guest opcional global;
- security tuple BFF+publishable+Customer bearer exata;
- serializer/rejected enum/property sets exatos;
- manifest exact-set com merge+ack M1, adapter fora M1 e nativo DENY;
- nenhum exemplo sensível; Swagger não interativa;
- `openapi:generate -- --surface store`, review diff, `openapi:lint`; `openapi:check` somente no gate final limpo.

### Sampling Rate recomendado

- **Per task commit:** unit/contract file diretamente afetado.
- **Per wave merge:** HTTP Phase 16 + PG Phase 16.
- **Phase gate:** suites completas relevantes, leakage, multiprocess, zero Order e OpenAPI clean-check.

### Wave 0 Gaps

- [ ] `src/modules/cart-merge/__tests__/decision.unit.spec.ts` — outcome/normalização/fingerprint.
- [ ] `integration-tests/http/cart-merge-review.spec.ts` — contrato completo e adapter.
- [ ] `integration-tests/modules/cart-merge-review.postgres.spec.ts` — rollback/locks/multiprocess.
- [ ] Fixtures/helpers para failpoints e workers sem providers reais.
- [ ] Casos Phase 16 nas suites de leakage, order invariants, manifest e OpenAPI.

## Security Domain

O projeto mantém `security_enforcement` habilitado e a Phase 16 combina autenticação, bearer capability, access control, input validation e hashing. As categorias abaixo seguem o ASVS como checklist de controles verificáveis, não como alegação de certificação. [CITED: https://owasp.org/www-project-application-security-verification-standard/]

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control nesta phase |
|---------------|---------|--------------------------------|
| V2 Authentication | yes | Customer JWT PG-authoritative e BFF credential; não aceitar sessão como substituto. |
| V3 Session Management | yes | Attach legado não usa session fallback; expiração/revogação Customer mantém padrão Phase 14. |
| V4 Access Control | yes | Customer ownership + capability binding revalidados dentro da tx; 404 não enumerável para foreign. |
| V5 Input Validation | yes | Zod strict, closed enums, quantidade inteira e `additionalProperties=false`. |
| V6 Cryptography | yes | HMAC/SHA-256/CSPRNG já existentes; nenhum algoritmo novo hand-rolled. |
| V7 Error/Logging | yes | Erros públicos minimizados; zero raw key/JWT/capability/hash em logs/Sentry. |
| V8 Data Protection | yes | Receipt/review minimizados, sem catálogo/PII/provider/secret. |
| V13 API/Web Service | yes | BFF-only, publishable+bearer+capability conforme operação, OpenAPI não interativa. |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Capability roubada/reutilizada | Spoofing | Hash-only, Customer+BFF simultâneos, consumed só no same-key committed replay. |
| Double-merge por race | Tampering | Customer/cart advisory xact locks, row locks, unique claim, revalidation. |
| Key replay com intenção diferente | Tampering | HMAC key scope + canonical fingerprint + 409 zero-effect. |
| Cart foreign enumeration | Information Disclosure | 404 uniforme e serializers sem IDs internos. |
| Leakage em receipt/review | Information Disclosure | Projeção mínima, property-set tests e canários em oito sinks. |
| Deadlock/lock starvation | Denial of Service | Ordem global de locks, transação curta e testes multiprocess. A documentação PostgreSQL recomenda ordem consistente para múltiplos objetos. [CITED: https://www.postgresql.org/docs/current/explicit-locking.html] |
| Partial commit | Tampering / Repudiation | Um transaction manager e failpoint evidence por write. |
| Bypass via attach/nativo | Elevation of Privilege | Adapter no mesmo motor; sessão erro; native route continua DENY. |

PostgreSQL documenta que locks `FOR UPDATE` bloqueiam writers/lockers concorrentes até o fim da transação, que advisory transaction locks são liberados automaticamente no fim e que aplicações precisam usar advisory locks consistentemente porque o servidor não impõe seu significado. Isso sustenta a estratégia, mas a correção depende de todos os paths adotarem a ordem proposta. [CITED: https://www.postgresql.org/docs/current/explicit-locking.html; https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS]

## Environment Availability

Auditoria local somente; nenhum provider, DB/Redis remoto ou infraestrutura real foi acessado.

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | build/tests futuros | ✓ | 22.23.1 | — |
| npm | scripts futuros | ✓ | 10.9.8 | — |
| PostgreSQL client | diagnóstico/harness PG futuro | ✓ | 17.10 | DB disposable configurada pela suite; não usar remote |
| Docker CLI/runtime | possível DB disposable | ⚠ CLI localizado, execução não confirmada (`rtk` I/O error) | — | harness PostgreSQL já existente do projeto |
| Redis CLI/service | não autoritativo | ✗ | — | testes críticos devem provar correção sem Redis |

**Missing dependencies with no fallback:** none para produzir esta pesquisa.
**Missing/unconfirmed with fallback:** Redis não é necessário à autoridade; Docker pode ser substituído pelo harness PostgreSQL existente no gate futuro.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | Nenhuma factual claim depende apenas de training knowledge. Recomendações de desenho estão marcadas como `RECOMMENDATION`/`OPEN DECISION`; fatos têm fonte local ou documentação oficial. | Todas | — |

## Open Questions / Human Decisions Required

1. **Regra de `CUSTOMER_CART_PRESERVED`**
   - What we know: D16-07/08 exigem regra determinística previamente aprovada e proíbem fallback.
   - Gap: nenhuma regra existe.
   - Recommendation: manter literal no enum, mas sem branch nem teste positivo. Isto não bloqueia planejamento/implementação dos outros quatro outcomes; bloqueia apenas tornar este outcome alcançável.

2. **Promoção sem destino com aceitação parcial**
   - What we know: D16-04 nomeia `GUEST_CART_ATTACHED`; D16-16/17 exigem `MERGED_PARTIAL` quando divergência foi aplicada.
   - Gap: precedência do outcome não está expressa.
   - Recommendation: `GUEST_CART_ATTACHED` somente quando todo conteúdo elegível é preservado; se parte é aceita e parte rejeitada, usar `MERGED_PARTIAL` e associar o cart resultante. Exige confirmação humana.

3. **Review pendente após mutação estrutural**
   - What we know: acknowledge da versão anterior fica inaplicável e review não é reativada automaticamente.
   - Gap: o texto não diz expressamente se pending vira superseded/false.
   - Recommendation: mutação posterior supersede pending na mesma tx, sem bump adicional, e só novo partial cria review. Exige confirmação humana antes de tocar line-item mutation/checkout guard.

4. **Shape de replay após ACK/mutação**
   - What we know: D16-33 permite snapshot original ou cart atual + outcome original; reconstruir e perder receipt é proibido.
   - Gap: `{outcome,cart,review}` sozinho não distingue review original de estado atual após ACK.
   - Recommendation: cart/ETag atuais do mesmo snapshot + bloco fechado `mergeReceipt` original + review atual. Se nenhum campo puder ser adicionado, escolher conscientemente snapshot original com retenção/minimização. Exige aprovação de contrato.

5. **Body/idempotência do acknowledge**
   - What we know: ref divergente falha e “sem pending” é no-op.
   - Gap: `reviewRef` obrigatório não representa naturalmente o no-op sem review; D16 não exige explicitamente Idempotency-Key no ACK.
   - Recommendation: body strict `{reviewRef: string|null}` e Idempotency-Key obrigatório para POST, mantendo ref/status como idempotência de domínio. Exige confirmação de contrato.

6. **Retenção do receipt/review**
   - What we know: replay precisa sobreviver ao consumo e não pode persistir secrets/PII desnecessários.
   - Gap: prazo de retenção não está definido.
   - Recommendation: alinhar `CartMergeResult` à retenção existente de `StoreIdempotency`; conservar `CartReview` enquanto necessário para estado/auditoria interna e aplicar política documental posterior. Não inventar prazo nesta phase.

7. **Linha sem `variantId` e duplicatas físicas Customer**
   - What we know: intenção guest é agregada por variant e rejected item exige identificador público seguro.
   - Gap: não há reason code para linha sem variant; não há regra explícita para Customer já corrompido com duplicatas.
   - Recommendation: falhar fechado tecnicamente, zero efeito, até regra/migration aprovada; não fabricar `VARIANT_INVALID` sem identificador público.

## Sources

### Primary — HIGH confidence

- `.planning/phases/16-cart-merge-review/16-CONTEXT.md` — D16-01..D16-42, boundary e referências canônicas.
- `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md` — gate e `MRG-01..MRG-08` abertos.
- Phase 13–15 CONTEXT/CLOSURE/PR27/ledger — BFF, auth, capability, CAS, snapshot/ETag e zero Order aceitos.
- `apps/backend/src/api/store/carts/line-item-mutation.ts` — transaction manager, lock, CAS, invalidation e snapshot.
- `apps/backend/src/modules/guest-cart-capability/service.ts` — hash/lifecycle/locks/sharedContext.
- `apps/backend/src/modules/store-idempotency/service.ts` e `operations.ts` — HMAC, fingerprint, claims e gaps transacionais/metadata.
- `apps/backend/src/modules/store-resource-version/service.ts` — `FOR UPDATE`, CAS e versão.
- `apps/backend/src/api/store/customers/me/cart/attach/route.ts`, `attach-guest-cart.ts`, `customer-active-cart.ts`, `active/route.ts` — comportamento legado e race de canonicalidade.
- `apps/backend/src/api/store/carts/serializers.ts`, store manifest/BFF tuple e registry OpenAPI — contrato/surface vigente.
- Suites HTTP/PG listadas em `16-CONTEXT.md`, mais helpers multiprocess/leakage e provas transacionais existentes.
- `docs/PRD_Backend_v1.1.md`, `PRD_frontend_v1.1.md`, `FRONTEND_CONTRACT_TRACEABILITY.md`, `SRS_v1.5.md`, `DB_MODEL_v1.21.md`, `DB_MODEL_v1.22.md` — contratos de produto/dados.

### Secondary — MEDIUM confidence

- [PostgreSQL — Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html) — row locks, deadlocks, advisory locks e ordem consistente; fonte oficial consultada via research seam/web.
- [PostgreSQL — Advisory Lock Functions](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS) — funções de lock de aplicação; fonte oficial.
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) — checklist de segurança; fonte oficial.

### Tertiary — LOW confidence

- None. Nenhuma fonte comunitária ou package novo foi usada.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — versões e scripts lidos do workspace/ambiente; nenhuma dependência nova.
- Architecture baseline: HIGH — confirmada em código, testes e authorities aceitas.
- Arquitetura física proposta: MEDIUM — compatível com seams atuais, mas modelos/contratos destacados precisam de aprovação humana.
- Pitfalls/validation: HIGH — derivados de gaps concretos e provas já existentes.

**Research date:** 2026-08-22
**Valid until:** 2026-09-21 para o baseline; revalidar se Phase 15/Medusa/data model mudarem antes do PLAN.

## Research Gate

- `16-RESEARCH.md`: created.
- D16-01..D16-42: preserved verbatim.
- MRG-01..MRG-08: unchanged / open.
- PLAN: NOT STARTED.
- EXECUTION: NOT STARTED.
- Deploy/providers/remote infra/frontend: NOT TOUCHED.
- Próximo passo permitido: HUMAN REVIEW somente.
