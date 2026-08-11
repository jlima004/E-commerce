# Phase 13: Storefront Contract Foundation & Surface Lockdown — Research

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### D13-01 — BFF is the only storefront consumer

O único consumidor storefront autorizado do Medusa no Frontend M1 é o BFF
same-origin:

```text
Browser → same-origin Next.js BFF → server-to-server Medusa Store API
```

Browser → Medusa direto é proibido.

#### D13-02 — Server-side credentials and capabilities

Publishable API key, Customer JWT quando possível pelo contrato aprovado, guest
cart capability, confirmation session e montagem de headers sensíveis
permanecem server-side no BFF. O Store OpenAPI documenta BFF → Medusa, não
browser → Medusa.

#### D13-03 — Store surface is fail-closed

A Store API do Frontend M1 opera em modelo fail-closed. Ausência de classificação
ou prova suficiente não equivale a autorização.

#### D13-04 — Mandatory route classification

O RESEARCH deve classificar cada operação Store relevante da versão instalada
como exatamente uma de:

```text
AUTHORIZED
EXTENDED
BLOCKED
OUTSIDE_FRONTEND_M1
```

O CONTEXT não antecipa a classificação completa.

#### D13-05 — Native bypass is a blocker

Qualquer rota nativa ou customizada que contorne authentication, guest
capability, ownership, `ETag`/`If-Match`, checkout validation, shipping
selection, `PaymentAttempt`, confirmation flow ou webhook Stripe canônico é
blocker binário da phase.

#### D13-06 — No Store path may create Order

Nenhuma operação Store pode criar `Order` diretamente ou oferecer caminho
equivalente ao fluxo canônico do webhook Stripe. Esta regra prevalece sobre
conveniência de rota nativa, compatibilidade de frontend ou abstração Medusa.

#### D13-07 — Native reuse requires invariant parity

Uma rota nativa pode ser autorizada ou estendida somente se obedecer aos mesmos
invariantes, autorização, concorrência, erros e contratos da superfície
aprovada. Reutilizar engine Medusa é preferível quando seguro; duplicá-la sem
necessidade é indesejado.

#### D13-08 — Stable public error codes

`code` é contrato público estável. `message` é apresentação e nunca deve ser
fonte de lógica do frontend.

#### D13-09 — Minimal allowlisted envelope

O futuro `StoreErrorResponse` deve fornecer, quando aplicável:

```text
code
message
correlationId
retryable
fieldErrors?
safe resource snapshot?
```

O schema final e os nomes exatos do snapshot pertencem a RESEARCH/PLAN.

#### D13-10 — Internal details never escape

Erros internos ou de provider não expõem payloads, IDs internos, stack,
secrets, capabilities, PII ou estado financeiro além do mínimo público.

#### D13-11 — Sanitized correlation ID

`x-correlation-id` é recebido ou gerado sob allowlist de formato/tamanho,
substituído quando inválido e nunca derivado de token ou identificador sensível.

#### D13-12 — Authorization is non-enumerable

Respostas de autorização/ownership devem ser mínimas e não permitir inferir a
existência ou o estado de recursos alheios.

#### D13-13 — Caller-provided key where required

Operações Store classificadas como repetíveis/mutáveis devem poder exigir
`Idempotency-Key` fornecida pelo caller BFF conforme o contrato de cada operação.

#### D13-14 — Scope is operation, actor and resource

O registro lógico de idempotência é escopado por operação, ator/ownership e
recurso quando aplicável. Uma key não é global e não transfere autorização.

#### D13-15 — Semantic request fingerprint

Cada uso persistido deve possuir fingerprint semântico suficiente para
distinguir a mesma intenção de uma intenção incompatível. Campos não
semânticos ou voláteis não devem causar divergência artificial.

#### D13-16 — Replay and incompatible reuse

Mesma key + mesma intenção pode reutilizar o resultado seguro já obtido.
Mesma key + intenção incompatível deve falhar com código público estável e sem
novo efeito colateral.

#### D13-17 — Finite retention and data minimization

Registros têm retenção finita por contrato/operação. Nenhum secret, capability,
token puro ou PII sensível é persistido para reproduzir resposta. O TTL exato e
o schema físico ficam para RESEARCH.

#### D13-18 — Idempotency is not concurrency control

Idempotência, transactional locking, database constraints, optimistic
concurrency e ownership validation são mecanismos distintos e complementares.
`Idempotency-Key` não substitui nenhum deles.

#### D13-19 — Concurrent retries require dedicated proof

Retries concorrentes devem ser cobertos futuramente por testes específicos de
claim, replay e conflito; testes apenas sequenciais não bastam para afirmar
segurança concorrente.

#### D13-20 — Server-authoritative monotonic version

Recursos Store concorrentes, especialmente Cart, precisam de versão canônica,
server-authoritative e monotônica.

#### D13-21 — ETag and If-Match

Respostas versionadas retornam `ETag`. Mutações protegidas exigem `If-Match`.
A versão do caller nunca se torna fonte autoritativa.

#### D13-22 — Stale write semantics

Stale mutation retorna:

```text
HTTP 412
code = CART_VERSION_MISMATCH
```

Um snapshot canônico seguro pode acompanhar o erro quando o contrato permitir.

#### D13-23 — No destructive automatic retry

O BFF não deve repetir automaticamente mutação destrutiva após conflito. Deve
substituir/reconciliar o estado local com a verdade canônica e exigir nova
intenção do usuário quando necessário.

#### D13-24 — Physical mechanism deferred

Coluna própria, model próprio, metadata ou outro mecanismo não são decididos
neste gate. A solução futura deve provar monotonicidade, atomicidade e ausência
de lost update.

#### D13-25 — Store contract target

O target do contrato Store é `1.1.0`.

#### D13-26 — TypeScript registry remains source of truth

O registry TypeScript em `apps/backend/src/api-docs/` continua autoridade. JSON
gerado nunca é editado manualmente.

#### D13-27 — Stable and closed contract primitives

A fundação deve preservar operationIds estáveis, schemas fechados, security
schemes explícitos, headers explícitos, BRL, unidade monetária explícita,
códigos de erro estáveis e drift detection.

#### D13-28 — Foundation, not future-operation materialization

A Phase 13 prepara os primitivos transversais; não materializa antecipadamente
todas as operações das Phases 14–21.

#### D13-29 — Downstream generation compatibility

O contrato deve ser consumível posteriormente por geração de tipos TypeScript,
schemas Zod, fixtures, mocks e contract tests, sem criar frontend neste
milestone.

#### D13-30 — As-built is evidence, not completion

Comportamentos v1.0 existentes são fatos e invariantes herdados. Não tornam
`FND-01..FND-08` completos sem os artefatos e provas v1.1 exigidos.

#### D13-31 — Research uncertainty fails closed

Questões dependentes de framework, persistência, locks, migrations, Redis,
PostgreSQL ou rota nativa permanecem abertas para RESEARCH. Não serão resolvidas
por suposição neste CONTEXT.

#### D13-32 — Manual gate

Após este arquivo, o fluxo para obrigatoriamente em revisão humana. RESEARCH,
PLAN, SPEC/SDD, implementation prompt, execution, verification, review,
closure, deploy, provider real e frontend continuam não autorizados.

### Agent Discretion

Nenhuma discricionariedade para relaxar boundary, fail-closed, invariantes de
`Order`, error minimization, idempotência, concorrência, target `1.1.0`, escopo
ou progressão de gate. O RESEARCH futuro poderá comparar técnicas apenas dentro
dessas decisões e mediante autorização explícita.

### Deferred Ideas (OUT OF SCOPE)

- implementação de auth, capability, merge, checkout, shipping, payment,
  confirmation, order summary e catalog revalidation permanece nas Phases
  14–21;
- types, Zod, fixtures, mocks, full contract tests e release/handoff pertencem
  à Phase 22;
- frontend/Next.js permanece fora do milestone backend.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Descrição vinculante | Suporte desta pesquisa |
|---|---|---|
| FND-01 | Auditar a superfície Store instalada e classificar cada operação nativa como autorizada, bloqueada, estendida ou fora do Frontend M1. | Inventário completo de 58 operações e matriz de classificação na seção 5. |
| FND-02 | Aplicar allowlist explícita e provar que nenhuma rota nativa alternativa contorna autenticação, capability, concorrência, checkout ou a proibição de criar `Order`. | Arquitetura fail-closed, mapa de nascimento de `Order` e prova negativa nas seções 7 e 13. |
| FND-03 | Padronizar `StoreErrorResponse`, códigos estáveis, `fieldErrors`, status HTTP e `x-correlation-id` sanitizado. | Envelope, catálogo semântico e adaptação do handler nas seções 8 e 12. |
| FND-04 | Definir e persistir registros de idempotência escopados por operação, ator e recurso, com fingerprint, resultado e retenção. | Modelo PostgreSQL prescritivo na seção 9. |
| FND-05 | Rejeitar reutilização de `Idempotency-Key` com payload semanticamente incompatível e impedir que idempotência substitua locks/constraints. | Máquina de estados, constraint única e separação de mecanismos nas seções 9 e 11. |
| FND-06 | Definir primitivo de versão monotônica e optimistic concurrency reutilizável pelos recursos Store concorrentes. | `StoreResourceVersion`, transação e ETag/If-Match na seção 10. |
| FND-07 | Fixar BFF same-origin como consumidor storefront, com security schemes e headers transversais explícitos, sem autorizar browser → Medusa direto. | Boundary e componentes OpenAPI na seção 12. |
| FND-08 | Preparar a fundação do Store OpenAPI `1.1.0`, incluindo schemas monetários BRL com unidade explícita e operação/erro/header estáveis. | Gap e fundação registry-first nas seções 6 e 12. |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- Responder em Português do Brasil; manter Medusa v2 + Node.js + TypeScript. PostgreSQL/Supabase e Redis são a persistência/infraestrutura estabelecida. [VERIFIED: `AGENTS.md`]
- Stripe e Gelato são os únicos providers aprovados; nenhuma rota Store pode criar `Order` antes do webhook Stripe confiável, e o fluxo v1.0 não pode ser contornado. [VERIFIED: `AGENTS.md`]
- Tokens de tracking, secrets, dados completos de cartão, capabilities, CPF cru e demais valores sensíveis não podem aparecer em logs, telemetry, exemplos ou persistência inadequada. [VERIFIED: `AGENTS.md`]
- O mercado é Brasil/BRL, single-currency, e contratos precisam antecipar o BFF/storefront futuro sem criar o frontend agora. [VERIFIED: `AGENTS.md`]
- O registry TypeScript de `apps/backend/src/api-docs/` é a autoridade; JSON gerado nunca é editado manualmente, Swagger permanece não interativo e exposição em produção exige gate humano próprio. [VERIFIED: `AGENTS.md`]
- Este gate é pesquisa-only; a única escrita autorizada é este arquivo, via `apply_patch`. Não há teste, build, runtime, DB, Redis, provider, geração OpenAPI, pacote, migration, commit ou outro artefato. [VERIFIED: pedido autorizado da Phase 13]

## 1. Research Scope

**Data:** 2026-08-07. **Domínio:** superfície HTTP Store do Medusa 2.16.0, contrato público, idempotência e optimistic concurrency. **Confiança geral:** HIGH para o as-built local; MEDIUM para a direção física que ainda exige prova transacional no PLAN futuro. [VERIFIED: codebase e pacote instalado]

Esta pesquisa responde `R13-01..R13-16` e fornece mapa factual para um PLAN futuro. Ela não materializa allowlist, schemas, models, migrations ou testes e não declara nenhum requisito concluído. [VERIFIED: escopo autorizado]

**Responsabilidade arquitetural:**

| Capability | Tier primário | Tier secundário | Razão |
|---|---|---|---|
| BFF-only e allowlist Store | API/Backend | Frontend Server (BFF futuro) | Medusa deve negar no boundary; o BFF apenas monta credenciais server-side. |
| Erro público e OpenAPI | API/Backend | — | Registry e normalização pertencem ao backend. |
| Idempotência | Database/Storage | API/Backend | PostgreSQL mantém a verdade; middleware/service aplica semântica. |
| Versão monotônica | Database/Storage | API/Backend | Incremento condicional atômico; API transporta ETag/If-Match. |
| Coordenação de concorrência | Database/Storage | API/Backend | Row locks/constraints garantem correção; Redis pode reduzir contenção. |
| Criação de Order | API/Backend webhook | Database/Storage | Somente entrypoint canônico pós-webhook e registros duráveis. |

## 2. Binding Context Decisions

As decisões `D13-01..D13-32`, copiadas integralmente no primeiro bloco, são vinculantes. A pesquisa não encontrou base para flexibilizar BFF-only, fail-closed, ausência de `Order` em Store, minimização de erros, separação de idempotência/locking, versão monotônica ou registry-first. [VERIFIED: `13-CONTEXT.md`]

O fato as-built de uma rota funcionar ou constar no manifest não a autoriza. As
quatro classes têm a seguinte semântica vinculante: [VERIFIED: D13-03..D13-07]

- `AUTHORIZED`: operação autorizada a permanecer executável quando todos os
  controles transversais aplicáveis estiverem satisfeitos.
- `EXTENDED`: operação conhecida e candidata ao Frontend M1, mas **não**
  automaticamente autorizada a executar. Permanece fail-closed até a phase
  proprietária materializar, habilitar explicitamente e provar todos os
  controles específicos exigidos. A classe registra apenas que o engine/rota
  pode ser reutilizado futuramente mediante extensão.
- `BLOCKED`: operação incompatível com o contrato ou seus invariantes; deve ser
  negada.
- `OUTSIDE_FRONTEND_M1`: operação fora do contrato Frontend M1; deve permanecer
  indisponível para a superfície autorizada do M1.

Consequência obrigatória: **`EXTENDED != runtime allowed`**. Uma entrada
`EXTENDED` sem habilitação explícita futura da phase proprietária deve ser
negada pelo manifest/guard da Phase 13. O PLAN futuro deve prever metadata de
habilitação explícita ou mecanismo equivalente, sem esta pesquisa escolher
agora sua implementação física.

## 3. Method and Evidence Sources

Ordem aplicada: repo e artefatos v1.1 → `node_modules`/manifests instalados → fonte oficial Medusa. O inventário foi obtido por leitura estática de todos os `route.js` instalados sob `@medusajs/medusa/dist/api/store`, seus middlewares/validators, rotas locais e registry OpenAPI; nenhum runtime foi executado. [VERIFIED: inspeção read-only local]

| Evidência | Uso | Strength |
|---|---|---|
| `apps/backend/package.json`, lockfile e `node_modules` | Versões e fonte executável instalada | PROVEN |
| `apps/backend/src/api/**`, módulos e `medusa-config.ts` | Guardas, serializers e caminho canônico | PROVEN |
| `apps/backend/src/api-docs/**` e iniciativa API-DOCS-01 | Contrato atual e gates | PROVEN |
| CONTEXT/REQUIREMENTS/PRDs/SRS/DB model/traceability | Decisões e contratos-alvo | PROVEN |
| Fonte oficial Medusa tag/current docs | Semântica de router, locking e transação | SUPPORTED; a tag 2.16.0 prevalece sobre docs `develop` |
| Recomendações de modelagem física | Síntese compatível com evidência | INFERRED até prova transacional futura |

O knowledge graph local está desabilitado; nenhuma conclusão dependeu dele. [VERIFIED: `gsd_run graphify status`]

### Discovery commands used (read-only)

| Comando/classe efetivamente usada | Finalidade |
|---|---|
| `node .codex/gsd-core/bin/gsd-tools.cjs query init.phase-op 13` | Resolver diretório, número padded, flags e artefatos existentes da Phase 13. |
| `gsd_run graphify status` | Confirmar que o knowledge graph estava desabilitado; nenhuma query de graph foi executada. |
| `gsd_run query research-plan`, `classify-confidence` e `research-store put` | Obter o plano/provider da pesquisa oficial, classificar confiança e persistir somente digests no cache de pesquisa do GSD. |
| Consultas Context7 `resolve-library-id` / `query-docs` | Consultar documentação oficial Medusa sobre routing, middleware, locking, transactions e idempotency de workflow. |
| `npm view <package> version/time` | Confirmar existência, versão publicada e data de publicação dos packages Medusa 2.16.0 no registry npm. |
| `rtk rg`, `rtk proxy rg`, `rtk rg --files` | Localizar arquivos, exports de rotas, middlewares, validators, handlers, schemas, operações OpenAPI, módulos e usos de primitives no repo/pacote instalado. |
| `rtk sed`, `rtk head`, `rtk tail`, `rtk wc` | Ler integralmente ou por trechos fontes locais, documentação vinculante e resultados de inventário; conferir tamanho/estrutura do artefato. |
| Scan estático read-only dos `route.js` em `node_modules/@medusajs/medusa/dist/api/store` e `/auth` | Contar arquivos/operações e extrair método+caminho sem iniciar o servidor. |
| `sort`, `uniq`, `wc -l` sobre saída de `rtk proxy rg` | Recontar classificações, operações, seções, perguntas e linhas das matrizes. |
| `rtk git status --short`, `rtk git diff --check`, `rtk git diff --stat` | Confirmar escopo de escrita e integridade textual, sem stage ou commit. |

Nenhum comando acima executou servidor/runtime da aplicação, teste, build, geração OpenAPI, migration, acesso a PostgreSQL/Supabase, Redis, Stripe, Gelato ou qualquer provider real. A única escrita no repositório foi este `13-RESEARCH.md` por `apply_patch`; o input temporário do research-plan ficou fora do repo. [VERIFIED: histórico desta pesquisa]

**PD13-01 — ACCEPTED PROCESS DEVIATION:** `research-store put` persistiu digests
no cache interno de pesquisa do GSD, fora do repositório, apesar da cerca
read-only pretendida. A revisão humana aceitou o evento como desvio histórico
exclusivamente processual e não bloqueante: não houve mutation no repositório,
runtime/produto, database, Redis ou provider; nenhum secret ou raw evidence foi
declarado persistido; os findings técnicos não foram invalidados. O audit trail
deve ser preservado, sem limpeza destrutiva e sem apagar ou “corrigir” o
histórico. Cleanup não é necessário nem autorizado. O comando não pode ser
repetido em futuro gate read-only sem autorização explícita. [PROVEN: histórico
desta pesquisa + disposição humana P13-RESEARCH-R1]

## 4. Installed Medusa 2.16.0 Facts

| Fato | Evidência | Strength |
|---|---|---|
| `@medusajs/cli`, `@medusajs/framework` e `@medusajs/medusa` estão fixados em `2.16.0`; Node em `>=22 <23`. | manifests local/instalado | PROVEN |
| A release npm 2.16.0 foi publicada em 2026-06-18; `2.18.0` é mais recente, mas upgrade não faz parte desta phase. | npm registry + pin local | PROVEN |
| O router aplica CORS Store, publishable-key e auth contextual antes de middlewares/handlers ordenados; matchers globais precedem wildcard/static/params. | `@medusajs/framework/dist/http/router.js` e `routes-sorter.js` | PROVEN |
| `middlewares.ts` aceita matcher/methods/body parser/error handler; rota de mesmo caminho pode substituir a anterior e `defineFileConfig({isDisabled:true})` pode desabilitar arquivo de rota. | loaders instalados 2.16.0 | PROVEN |
| O namespace Store instalado contém 44 arquivos de rota e 51 operações método+caminho. | scan estático dos exports `route.js` | PROVEN |
| A rota nativa `POST /store/carts/{id}/complete` executa `completeCartWorkflowId` e devolve `order`; logo cria `Order` fora do webhook. | fonte instalada `.../carts/[id]/complete/route.js` | PROVEN / BLOCKER |
| O módulo Locking está configurado no projeto com provider Redis; a interface instalada fornece `execute/acquire/release`. | `medusa-config.ts` + tipos 2.16.0 | PROVEN |
| Serviços de Cart instalados aceitam `sharedContext`/transaction manager; a atomicidade cruzada entre Cart core e novo módulo precisa ser provada. | fontes/tipos instalados + docs oficiais | SUPPORTED, prova futura necessária |

Não instalar nem atualizar pacote: todas as conclusões usam a versão fixada. [VERIFIED: escopo e manifests]

## 5. Runtime Store Surface Inventory

### Contagens canônicas de pesquisa

| Métrica | Contagem | Observação |
|---|---:|---|
| Operações runtime `/store` | **58** | 51 nativas + 7 locais não sobrepostas; produto local apenas estende 2 nativas. |
| Operações no documento OpenAPI Store atual | **10** | 2 health + 8 `/store`. |
| Operações runtime `/store` documentadas | **8** | produtos 2, active cart 2, attach, card, Pix, tracking. |
| Gap runtime `/store` sem operação OpenAPI | **50** | `58 - 8`. |
| Operações Store relevantes classificadas | **58** | toda operação runtime encontrada. |
| Operações não classificadas | **0** | qualquer futura diferença deve falhar closed. |
| `AUTHORIZED` / `EXTENDED` / `BLOCKED` / `OUTSIDE_FRONTEND_M1` | **0 / 10 / 17 / 31** | classificação corrigida para o PLAN. |

[VERIFIED: scan estático de `node_modules/@medusajs/medusa/dist/api/store`, `apps/backend/src/api/store` e registry]

### Legenda de guardas/fontes

- `G`: controles globais nativos Store (CORS, publishable key, contexto de auth/locale); não é allowlist. `A`: auth customer requerida. `O`: auth opcional. `P`: middleware/ownership/serializer local específico. `—`: além de `G`, nenhum guard transversal v1.1. [VERIFIED: router e `apps/backend/src/api/middlewares.ts`]
- `N`: pacote Medusa 2.16.0; `L`: rota local; `N+P`: handler nativo estendido localmente. Cada linha abaixo deriva desses arquivos, e a classificação é recomendação vinculada às decisões D13. [VERIFIED: fontes locais]

### Matriz completa

| # | Method | Path | Native/Custom | Runtime Source | Current Guard | Current Public Contract | M1 Relevance | Preliminary Classification | Risk |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | POST | `/store/carts` | Native | N carts/route | G/O | none | substituída por active cart | BLOCKED | contorna capability/idempotência |
| 2 | GET | `/store/carts/{id}` | Native | N carts/[id] | G/O | none | leitura cart futura | BLOCKED | ID direto/ownership ausente |
| 3 | POST | `/store/carts/{id}` | Native | N carts/[id] | G/O | none | mutation futura | BLOCKED | sem capability/If-Match |
| 4 | POST | `/store/carts/{id}/complete` | Native | N carts/[id]/complete | G/O | none | proibida | BLOCKED | cria `Order` diretamente |
| 5 | POST | `/store/carts/{id}/customer` | Native | N carts/[id]/customer | G/A | none | merge futuro | BLOCKED | fluxo alternativo de attach/merge |
| 6 | POST | `/store/carts/{id}/line-items` | Native | N line-items | G/O | none | cart M1 | EXTENDED | exige capability, key, If-Match, DTO |
| 7 | POST | `/store/carts/{id}/line-items/{line_id}` | Native | N line-items/[line_id] | G/O | none | cart M1 | EXTENDED | exige capability, key, If-Match, DTO |
| 8 | DELETE | `/store/carts/{id}/line-items/{line_id}` | Native | N line-items/[line_id] | G/O | none | cart M1 | EXTENDED | destrutiva; sem retry automático |
| 9 | POST | `/store/carts/{id}/promotions` | Native | N promotions | G/O | none | fora M1 | OUTSIDE_FRONTEND_M1 | mutação não contratada |
| 10 | DELETE | `/store/carts/{id}/promotions` | Native | N promotions | G/O | none | fora M1 | OUTSIDE_FRONTEND_M1 | mutação não contratada |
| 11 | POST | `/store/carts/{id}/shipping-methods` | Native | N shipping-methods | G/O | none | shipping M1 | BLOCKED | contorna quote/select aprovado |
| 12 | POST | `/store/carts/{id}/taxes` | Native | N taxes | G/O | none | fora M1 | OUTSIDE_FRONTEND_M1 | recálculo não público |
| 13 | GET | `/store/collections` | Native | N collections | G/O | none | fora M1 | OUTSIDE_FRONTEND_M1 | expansão de catálogo |
| 14 | GET | `/store/collections/{id}` | Native | N collections/[id] | G/O | none | fora M1 | OUTSIDE_FRONTEND_M1 | expansão de catálogo |
| 15 | GET | `/store/currencies` | Native | N currencies | G/O | none | BRL fixa | OUTSIDE_FRONTEND_M1 | superfície multi-currency |
| 16 | GET | `/store/currencies/{code}` | Native | N currencies/[code] | G/O | none | BRL fixa | OUTSIDE_FRONTEND_M1 | superfície multi-currency |
| 17 | POST | `/store/customers` | Native | N customers/route | G/O | none | auth/register M1 | EXTENDED | Phase 14 deve restringir contrato |
| 18 | GET | `/store/customers/me` | Native | N customers/me | G/A | none | account M1 | EXTENDED | DTO/erro BFF-only necessários |
| 19 | POST | `/store/customers/me` | Native | N customers/me | G/A | none | fora M1 | OUTSIDE_FRONTEND_M1 | perfil não contratado |
| 20 | GET | `/store/customers/me/addresses` | Native | N addresses | G/A | none | fora M1 | OUTSIDE_FRONTEND_M1 | PII/endereço não contratado |
| 21 | POST | `/store/customers/me/addresses` | Native | N addresses | G/A | none | fora M1 | OUTSIDE_FRONTEND_M1 | PII/mutação não contratada |
| 22 | GET | `/store/customers/me/addresses/{address_id}` | Native | N addresses/[id] | G/A | none | fora M1 | OUTSIDE_FRONTEND_M1 | PII/enumeração |
| 23 | POST | `/store/customers/me/addresses/{address_id}` | Native | N addresses/[id] | G/A | none | fora M1 | OUTSIDE_FRONTEND_M1 | PII/mutação |
| 24 | DELETE | `/store/customers/me/addresses/{address_id}` | Native | N addresses/[id] | G/A | none | fora M1 | OUTSIDE_FRONTEND_M1 | destrutiva |
| 25 | GET | `/store/locales` | Native | N locales | G/O | none | fora M1 | OUTSIDE_FRONTEND_M1 | superfície não necessária |
| 26 | GET | `/store/orders` | Native | N orders | G/A | none | fora Phase 13/21 | OUTSIDE_FRONTEND_M1 | DTO/ownership futuros |
| 27 | GET | `/store/orders/{id}` | Native | N orders/[id] | G/O | none | summary futuro | BLOCKED | lookup por ID/ownership inadequado |
| 28 | POST | `/store/orders/{id}/transfer/accept` | Native | N order transfer | G/O | none | proibida M1 | BLOCKED | capacidade alternativa |
| 29 | POST | `/store/orders/{id}/transfer/cancel` | Native | N order transfer | G/A | none | proibida M1 | BLOCKED | capacidade alternativa |
| 30 | POST | `/store/orders/{id}/transfer/decline` | Native | N order transfer | G/O | none | proibida M1 | BLOCKED | capacidade alternativa |
| 31 | POST | `/store/orders/{id}/transfer/request` | Native | N order transfer | G/A | none | proibida M1 | BLOCKED | capacidade alternativa |
| 32 | POST | `/store/payment-collections` | Native | N payment-collections | G/O | none | payment M1 | BLOCKED | contorna PaymentAttempt |
| 33 | POST | `/store/payment-collections/{id}/payment-sessions` | Native | N payment-sessions | G/O | none | payment M1 | BLOCKED | contorna PaymentAttempt |
| 34 | GET | `/store/payment-providers` | Native | N payment-providers | G/O | none | fora M1 | OUTSIDE_FRONTEND_M1 | provider discovery exposta |
| 35 | GET | `/store/product-categories` | Native | N categories | G/O | none | fora M1 | OUTSIDE_FRONTEND_M1 | catálogo não contratado |
| 36 | GET | `/store/product-categories/{id}` | Native | N categories/[id] | G/O | none | fora M1 | OUTSIDE_FRONTEND_M1 | catálogo não contratado |
| 37 | GET | `/store/product-tags` | Native | N tags | G/O | none | fora M1 | OUTSIDE_FRONTEND_M1 | catálogo não contratado |
| 38 | GET | `/store/product-tags/{id}` | Native | N tags/[id] | G/O | none | fora M1 | OUTSIDE_FRONTEND_M1 | catálogo não contratado |
| 39 | GET | `/store/product-types` | Native | N types | G/O | none | fora M1 | OUTSIDE_FRONTEND_M1 | catálogo não contratado |
| 40 | GET | `/store/product-types/{id}` | Native | N types/[id] | G/O | none | fora M1 | OUTSIDE_FRONTEND_M1 | catálogo não contratado |
| 41 | GET | `/store/product-variants` | Native | N variants | G/O | none | fora M1 | OUTSIDE_FRONTEND_M1 | bypass do serializer de produto |
| 42 | GET | `/store/product-variants/{id}` | Native | N variants/[id] | G/O | none | fora M1 | OUTSIDE_FRONTEND_M1 | bypass do serializer de produto |
| 43 | GET | `/store/products` | Native+Custom | N+P products | G/O/P | Store 1.0.0 | catálogo M1 | EXTENDED | manter field allowlist/serializer |
| 44 | GET | `/store/products/{id}` | Native+Custom | N+P products/[id] | G/O/P | Store 1.0.0 | catálogo M1 | EXTENDED | manter field allowlist/serializer |
| 45 | GET | `/store/regions` | Native | N regions | G/O | none | BR única | OUTSIDE_FRONTEND_M1 | superfície regional genérica |
| 46 | GET | `/store/regions/{id}` | Native | N regions/[id] | G/O | none | BR única | OUTSIDE_FRONTEND_M1 | superfície regional genérica |
| 47 | GET | `/store/return-reasons` | Native | N return-reasons | G/O | none | fora M1 | OUTSIDE_FRONTEND_M1 | fluxo Admin operacional |
| 48 | GET | `/store/return-reasons/{id}` | Native | N return-reasons/[id] | G/O | none | fora M1 | OUTSIDE_FRONTEND_M1 | fluxo Admin operacional |
| 49 | POST | `/store/returns` | Native | N returns | G/O | none | fora M1 | OUTSIDE_FRONTEND_M1 | cria retorno fora do Admin |
| 50 | GET | `/store/shipping-options` | Native | N shipping-options | G/O | none | shipping M1 | BLOCKED | contorna quote contextual |
| 51 | POST | `/store/shipping-options/{id}/calculate` | Native | N shipping calculate | G/O | none | shipping M1 | BLOCKED | contorna quote/TTL/ownership |
| 52 | GET | `/store/carts/active` | Custom | L carts/active | G/O/P | Store 1.0.0 | cart M1 | EXTENDED | capability/version/erro ausentes |
| 53 | POST | `/store/carts/active` | Custom | L carts/active | G/O/P | Store 1.0.0 | cart M1 | EXTENDED | key/capability/version ausentes |
| 54 | POST | `/store/customers/me/cart/attach` | Custom | L customers attach | G/A/P | Store 1.0.0 | merge M1 | BLOCKED | sem novo contrato merge/review |
| 55 | POST | `/store/carts/{id}/payment-attempts/card` | Custom | L payment card | G/O/P | Store 1.0.0 | payment M1 | EXTENDED | requer capability/key/version hardening |
| 56 | POST | `/store/carts/{id}/payment-attempts/pix` | Custom | L payment pix | G/O/P | Store 1.0.0 | fora do Frontend M1 | OUTSIDE_FRONTEND_M1 | comportamento herdado/backend legado; Pix não integra o contrato M1 |
| 57 | POST | `/store/tracking/lookup` | Custom | L tracking | G/P | Store 1.0.0 | fora Frontend M1 | OUTSIDE_FRONTEND_M1 | limiter in-process/capability própria |
| 58 | GET | `/store/custom` | Custom scaffold | L custom | G/O | excluded | nenhum | BLOCKED | rota pública scaffold retorna 200 |

Não há rota classificada `AUTHORIZED`. As dez candidatas `EXTENDED` ainda
precisam do guard transversal e, depois, da habilitação explícita e dos
controles específicos de sua phase proprietária. Até isso ocorrer, permanecem
negadas: `EXTENDED != runtime allowed`. [VERIFIED: matriz e D13-03..D13-07]

## 6. OpenAPI vs Runtime Surface Gap

O documento Store atual declara `CONTRACT_VERSION = "1.0.0"`, não o texto histórico `1.0.0-draft.1` registrado no CONTEXT. Possui 10 operações totais: health live/ready e 8 operações `/store`. [VERIFIED: `apps/backend/src/api-docs/document.ts` e registry]

O manifest de evidência nativa atual cobre somente seis extensões (duas Store products e quatro Admin products); ele nunca pretendeu inventariar as 51 operações Store nativas. A exclusão explícita de `/store/custom` impede documentação, mas não impede execução runtime. [VERIFIED: iniciativa API-DOCS-01 e manifest local]

**Gap decisivo:** 50 de 58 operações runtime `/store` não têm operação OpenAPI
e não existe hoje manifest único que alimente tanto allowlist quanto coverage.
O PLAN deve criar um manifest Store versionado por Medusa `2.16.0`, com método,
template de caminho, origem, classificação, razão, modo de guard, expectativa
de inclusão no OpenAPI e habilitação explícita quando aplicável. O gate deve
falhar se o scan instalado divergir, se houver entrada sem classificação, se
uma `AUTHORIZED` ou `EXTENDED` explicitamente habilitada não tiver operação
registry, ou se `EXTENDED` não habilitada, `BLOCKED` ou
`OUTSIDE_FRONTEND_M1` ficar executável. [INFERRED a partir dos gates existentes;
HIGH]

## 7. Native Surface Lockdown Options

### Recomendação prescritiva

Usar **um manifest TypeScript estático e versionado da superfície Store** como fonte única de classificação, consumido por: (1) middleware global fail-closed, (2) coverage OpenAPI, (3) testes de matriz e (4) prova de drift da versão instalada. Registrar o middleware com matcher `/store*`, sem restrição de método, para que ele seja ordenado antes dos middlewares/handlers específicos. [INFERRED com suporte do router 2.16.0; HIGH]

O guard deve normalizar somente caminhos válidos, comparar método + template, tratar `OPTIONS` explicitamente para preflight, não herdar `HEAD` implicitamente de `GET`, e negar método desconhecido, alias, trailing slash ambígua, path codificado inesperado, entrada ausente, `BLOCKED` e `OUTSIDE_FRONTEND_M1`. A negação precisa ocorrer antes do handler nativo e usar o mesmo envelope Store sanitizado. [INFERRED do threat model e Express/Medusa routing; HIGH]

| Técnica | Decisão | Evidência/limite |
|---|---|---|
| Middleware global manifest-driven | **Primária** | Matchers globais são ordenados antes de rotas específicas no router instalado. [VERIFIED: framework 2.16.0] |
| Override de rota pelo mesmo path | Usar só para semântica `EXTENDED` | Loader permite sobreposição, mas não escala como prova completa de 58 operações. [VERIFIED: loader 2.16.0] |
| `defineFileConfig({isDisabled:true})` | Defesa em profundidade pontual | É mecanismo file-level; não substitui inventário/guard transversal. [VERIFIED: loader/docs oficiais] |
| CORS/publishable key nativos | Preservar, não tratar como autorização | Esses controles não provam BFF-only, ownership ou classificação. [VERIFIED: router/middleware instalado] |
| Lista separada no OpenAPI | **Não usar** | Duas listas independentes recriam drift. [INFERRED: arquitetura atual] |
| Monkey patch em `node_modules` | **Não usar** | Não é fonte versionada do projeto e se perde em instalação. [VERIFIED: modelo de dependência] |

### Fluxo recomendado

```text
BFF request
  → Store CORS/publishable context nativo
  → guard global de classificação
      ├─ UNKNOWN → DENY
      ├─ BLOCKED → DENY
      ├─ OUTSIDE_FRONTEND_M1 → DENY
      ├─ EXTENDED ainda não explicitamente habilitada → DENY
      └─ AUTHORIZED ou EXTENDED explicitamente habilitada
          → guards aplicáveis de ator/capability/ownership
          → guards aplicáveis de idempotência/concorrência
          → handler/engine Medusa reutilizado
          → serializer público fechado
```

A Phase 13 não abre operações downstream apenas porque elas aparecem no
manifest. A habilitação de uma `EXTENDED` depende da phase proprietária e de
prova específica posterior.

O BFF-only não é demonstrado apenas por CORS: publishable key, JWT/cookie, guest capability e confirmation session devem permanecer server-side, e o contrato/gates futuros precisam demonstrar que browser direto não possui o conjunto de credenciais/capacidades autorizado. [VERIFIED: D13-01/D13-02]

## 8. Error Contract Research

O handler Medusa 2.16.0 atualmente produz principalmente `{code,type,message}`; validation pode produzir `{type,message}` e alguns middlewares de auth respondem diretamente `{message:"Unauthorized"}`. O componente OpenAPI atual `StoreError` exige `type,message` e torna `code` opcional, incompatível com D13-08/D13-09. [VERIFIED: handler/auth instalado e `components/errors.ts`]

**Envelope público recomendado e fechado:**

```ts
type StoreErrorResponse = {
  code: string
  message: string
  correlationId?: string
  retryable: boolean
  fieldErrors?: Record<string, string>
  cart?: StoreCartResponse
}
```

[VERIFIED: PRD/SRS alvo; nome `cart` é o snapshot seguro previsto para conflito de Cart]

| Status | Semântica pública | Regras |
|---:|---|---|
| 400 | schema/request inválido | `fieldErrors` allowlisted quando seguro; sem eco de payload. |
| 401 | autenticação ausente/inválida | mensagem genérica; sem razão interna. |
| 403 ou 404 | política de acesso | mesma resposta para recurso alheio/inexistente conforme operação, sem enumeração. |
| 409 | idempotency intent conflict ou estado incompatível | códigos distintos; nunca depender de `message`. |
| 412 | `CART_VERSION_MISMATCH` | pode incluir `cart` canônico seguro e novo ETag. |
| 422 | regra de domínio | `fieldErrors` somente de campos públicos. |
| 429 | rate limit | `retryable` e `Retry-After` somente quando factual. |
| 500 | erro interno | código genérico, mensagem sanitizada, `retryable:false` por padrão. |
| 503 | dependência/indisponibilidade transitória | `retryable:true` apenas quando não houve efeito incerto. |

[VERIFIED: PRD/SRS e D13-08..D13-12; a taxonomia de códigos por operação pertence ao PLAN]

Estender o handler global existente preservando captura Sentry sanitizada e delegação Admin/Webhooks: quando `req.path` pertence a Store, normalizar erros conhecidos; fora de Store, manter comportamento atual. O guard global deve interceptar auth/classificação para impedir que respostas nativas `{message:"Unauthorized"}` escapem. Erros de publishable key anteriores ao guard ainda chegam ao error handler final e devem ser normalizados por namespace. [INFERRED com base na ordem instalada; HIGH]

O utilitário `resolveCorrelationId` já aceita apenas `[A-Za-z0-9._-]{1,128}`, substitui inválidos por UUID e define header; é base reutilizável. `correlationId` no body deve ser o mesmo valor já sanitizado, nunca provider ID, token ou capability. [VERIFIED: middleware local de correlation/access log]

## 9. Idempotency Research

`CheckoutCompletionLog` é corretamente específico do nascimento de `Order` por `payment_intent_id`; não é registro transversal. O `context.idempotencyKey` dos workflows Medusa auxilia replay de execução, mas não materializa sozinho scope operação+ator+recurso, fingerprint semântico e resposta HTTP segura exigidos. [VERIFIED: módulos locais e docs/fonte Medusa]

### Modelo físico recomendado: `StoreIdempotencyRecord`

| Campo/constraint | Recomendação |
|---|---|
| identidade | `id`, timestamps |
| scope | `operation`, `actor_scope_hash`, `resource_scope_hash`, `idempotency_key_hash` |
| intenção | `request_fingerprint` canônico |
| estado | `processing`, `completed`, `failed_retryable`, `failed_terminal`, `reconciliation_required` |
| resultado seguro | `result_type`, `result_id`, `response_status`, snapshot/header allowlisted |
| concorrência | `locked_at`, `attempt_count`, `completed_at`, `failure_code` |
| retenção | `expires_at` |
| unique | `(operation, actor_scope_hash, resource_scope_hash, idempotency_key_hash)` |
| índices | `(state, locked_at)` e `expires_at` |

[INFERRED: atende D13-13..D13-19; requer model/migration futura]

Chave e scopes devem ser HMAC/hash server-side; nunca persistir chave pura, capability, token, PII, provider payload ou `client_secret`. O fingerprint deve usar JSON canônico dos campos semânticos já validados e excluir correlation ID, headers voláteis e campos de apresentação. [VERIFIED: D13-15/D13-17 e regras de dados]

### Semântica de claim/replay

1. Inserir claim em transação PostgreSQL sob a constraint única. [INFERRED]
2. Em conflito, carregar o registro no mesmo scope e comparar fingerprint. [INFERRED]
3. `completed` + mesma intenção: devolver status/snapshot seguro previamente materializado, sem novo side effect. [VERIFIED: D13-16]
4. Fingerprint incompatível: `409` com código estável de reuso incompatível, sem efeito novo. [VERIFIED: D13-16]
5. `processing`: resposta estável retryable/in-progress; não executar em paralelo. [INFERRED]
6. Claim stale só pode ser retomado quando a operação prova ausência de side effect; efeito externo incerto vira `reconciliation_required`, nunca blind retry. [VERIFIED: invariantes v1.0]
7. Cleanup por job remove somente terminais expirados; não apagar `processing`/reconciliation. [INFERRED]

**TTL:** não foi encontrada duração canônica genérica. Persistir `expires_at`, definir policy map por operação e limite global; retenção deve cobrir a janela de retry/resultado incerto do BFF e ser finita/minimizada. Valores já existentes de token/quote/CPF pertencem a contratos distintos e não devem ser copiados. O valor exato permanece decisão manual de PLAN por operação; isso não bloqueia planejar o mecanismo, mas bloqueia implementar retenção sem decisão. [UNKNOWN controlado; D13-17]

Para resultados que contenham capability temporária, preferir rederivação determinística opaca a partir de secret server-side + salt/ID persistido, ou mecanismo cifrado explicitamente aprovado; nunca armazenar plaintext apenas para replay. [INFERRED; precisa threat review]

## 10. Optimistic Concurrency Research

`updated_at` ou `metadata` isolados não satisfazem D13-20: não há contador monotônico, uma mudança de line item pode não atualizar atomicamente a linha Cart, e não existe compare-and-swap explícito. [VERIFIED: modelos/fluxos Cart instalados; conclusão HIGH]

### Modelo físico recomendado: `StoreResourceVersion`

| Campo/constraint | Recomendação |
|---|---|
| chave | `resource_type`, `resource_id` |
| versão | `version bigint`, inicial `1`, check `version > 0` |
| unique | `(resource_type, resource_id)` |
| auditoria | timestamps |

[INFERRED: modelo próprio preserva isolamento Medusa e é reutilizável]

O primitive genérico deve permitir ETag forte e opaco derivado de recurso + ID
+ versão, por exemplo `"<resource>:<id>:v<version>"` ou representação
HMAC/base64 equivalente. A Phase 13 pode definir os componentes OpenAPI
transversais e provar que o servidor controla a versão; a integração pública
efetiva de `ETag`/`If-Match` e `CART_VERSION_MISMATCH` no Cart pertence à Phase
15. [VERIFIED: D13-20/D13-21/D13-28]

### Prova genérica de atomicidade futura na Phase 13

```text
opcional: lockingRedis.execute("store:<resource>:<id>") para coordenação curta
  → iniciar transação PostgreSQL compartilhada
  → SELECT/lock da StoreResourceVersion
  → validar expected version em recurso controlado de prova
  → executar mutação Medusa controlada com o mesmo transaction manager
  → UPDATE version = version + 1 WHERE version = expected RETURNING version
  → commit único
  → observar versão nova
```

Se o update condicional não retornar linha, a prova deve demonstrar ausência de
mutação e CAS atômico. Os contratos públicos finais de Cart — `ETag`,
`If-Match`, `412 CART_VERSION_MISMATCH`, snapshot seguro e invalidação
cart-specific — permanecem responsabilidade da Phase 15. [VERIFIED:
D13-22/D13-23/D13-28]

Os serviços Medusa 2.16.0 aceitam shared transaction context, mas o PLAN deve
abrir uma prova Wave 0 de que uma mutação controlada de recurso Medusa e o
módulo de versão realmente compartilham o mesmo transaction manager. Se isso
não for possível, a implementação do primitive fica **BLOCKED**; não aceitar
dois commits (mutação e versão) como “quase atômicos”. A Phase 15 reutiliza a
prova para integrar o Cart. [SUPPORTED: fonte instalada/docs; condição BLOCKER]

## 11. PostgreSQL / Redis / Locking Analysis

| Responsabilidade | Fonte de verdade | Papel permitido |
|---|---|---|
| Claim idempotente e replay | PostgreSQL unique + transação | Redis não substitui o registro. |
| Versão monotônica | PostgreSQL conditional update/row lock | Redis só coordena contenção. |
| Ownership/actor scope | Dados/módulos PostgreSQL + auth validada | Cache não concede autorização. |
| Serialização curta cross-dyno | locking Redis já configurado | Ajuda a evitar trabalho concorrente, mas expiração/falha não pode quebrar correção. |
| Side effect externo incerto | estado durável/reconciliation | Não usar lock como prova de não execução. |

[VERIFIED: configuração local + separação D13-18; recomendação INFERRED]

O provider atual `@medusajs/medusa/locking-redis` deve ser preservado para coordenação curta. `@medusajs/locking-postgres` aparece transitivamente instalado, mas não está configurado e não é necessário trocar provider ou adicionar dependência; row locks/conditional updates podem ficar dentro do módulo customizado PostgreSQL. [VERIFIED: config/package instalado]

Locks in-process existentes no rate limiter de tracking e em reservas operacionais não são controle cross-dyno. Tracking está fora do M1; o finding deve seguir para sua phase proprietária, não ser generalizado para a fundação. [VERIFIED: codebase]

## 12. OpenAPI Foundation Analysis

### Componentes que entram na Phase 13

| Componente | Estado atual | Target 1.1.0 |
|---|---|---|
| `StoreError` | `{type,message,code?}` | substituir por `StoreErrorResponse` fechado com `code,message,retryable,correlationId?,fieldErrors?,cart?` |
| correlation | request param + response header existem | preservar formato sanitizado e alinhar header/body |
| idempotência | ausente | parameter `Idempotency-Key`; respostas de replay/conflito e `Retry-After` quando aplicável |
| concurrency | ausente | components transversais de `If-Match`, `ETag` e erro 412; integração pública de Cart somente na Phase 15 |
| security | publishable key, customer bearer/session | declarar boundary BFF→Medusa; capability/confirmation apenas como primitives transversais quando sua semântica estiver fechada, sem operações futuras |
| money | schemas repetem `x-money-unit` | primitives fechados major/minor, `currency`/`currency_code = BRL/brl` conforme DTO, unidade obrigatória e inequívoca |
| version | `1.0.0` | `1.1.0`, somente via registry/generator no gate de implementação |

[VERIFIED: registry atual e D13-25..D13-29]

Recomenda-se `StoreMajorMoney` e `StoreMinorMoney` fechados (amount + BRL + discriminator de unidade) ou componentes equivalentes reutilizados por composição. O contrato atual já revela a fronteira: Cart/catalog públicos usam major units e `PaymentAttempt.amount` usa integer minor units. O PLAN deve eliminar números monetários semanticamente ambíguos sem alterar fatos v1.0. [VERIFIED: serializers/schemas atuais]

O manifest de superfície deve integrar o coverage: `AUTHORIZED` e `EXTENDED`
explicitamente habilitada exigem operação registry e guard correspondente;
`EXTENDED` não habilitada, `BLOCKED` e `OUTSIDE_FRONTEND_M1` não podem ficar
executáveis e exigem prova de negação runtime. Gerar os três JSONs somente no
futuro gate autorizado; `openapi:check` continua read-only e não pode ser
precedido pelo writer dentro do mesmo gate. [VERIFIED: AGENTS/API-DOCS-01]

Não materializar endpoints de auth, capability, merge, checkout, shipping, confirmação ou order summary nesta phase. Componentes só entram se forem transversais, fechados e usados pela fundação; operação futura permanece na phase 14–21. [VERIFIED: D13-28]

## 13. Order-Birth Negative Proof Strategy

### Mapa factual de nascimento de `Order`

```text
CAMINHO CANÔNICO APROVADO
POST /hooks/stripe (raw body + assinatura)
  → WebhookEventLog persistido/deduplicado
  → payment_intent.succeeded
  → PaymentAttempt validado → payment_confirmed_by_webhook
  → runCreateOrderFromConfirmedPaymentAttemptEntrypoint
  → claim único CheckoutCompletionLog
  → revalidação Cart ↔ PaymentAttempt
  → completeCartWorkflow
  → Order + correlações duráveis
  → purchase_completed / email / Gelato local pipeline

BYPASS NATIVO ATUAL
POST /store/carts/{id}/complete
  → completeCartWorkflowId
  → Order retornado ao caller Store
```

[VERIFIED: webhook/entrypoint/módulos locais e rota nativa instalada]

As rotas locais de card/Pix criam/atualizam `PaymentAttempt` e derivam dinheiro server-side; não criam `Order` sincronamente. O scan dos handlers Store nativos encontrou apenas `/carts/{id}/complete` invocando o workflow de completar Cart, mas essa prova estática não basta como gate final. [VERIFIED: codebase/pacote; limite explícito]

### Prova negativa futura obrigatória

1. Scan estático versionado de todas as 58 operações e dependências que referenciem `completeCartWorkflow`, `createOrder*` ou equivalentes; diferença bloqueia. [INFERRED]
2. HTTP matrix para método/path/alias/HEAD/trailing slash/encoded variants: toda `BLOCKED/OUTSIDE/unknown` falha antes do handler. [INFERRED]
3. Spy/instrumentação local do entrypoint de `completeCartWorkflow` prova zero chamadas por qualquer operação Store. [INFERRED]
4. Em PostgreSQL descartável, contagem de Orders permanece zero após todas as tentativas Store. [INFERRED]
5. Controle positivo: webhook `payment_intent.succeeded` válido cria exatamente um Order; replay cria/reutiliza o mesmo resultado, nunca segundo Order. [VERIFIED: invariant target]
6. Repetir prova com server e worker/retry concorrente isolados; mocks sequenciais não bastam. [VERIFIED: D13-19]

O teste atual `invariants-inv01-02-order-birth.spec.ts` cobre caminhos customizados com doubles, mas não atinge a rota nativa instalada `/store/carts/{id}/complete`; portanto não fecha FND-02. [VERIFIED: teste local]

## 14. Reusable Existing Infrastructure

| Ativo existente | Reuso | Limite/gap |
|---|---|---|
| Registry TypeScript, generator e coverage API Docs | **Estender** | Falta manifest completo Store e primitives 1.1.0. |
| Serializer público de products | **Reusar** | Deve permanecer atrás da allowlist global. |
| Serializer reduzido de Cart/CPF mascarado | **Estender** | Falta versão/ETag e snapshot de erro. |
| `resolveCorrelationId` + access logger | **Reusar** | Levar o mesmo ID ao envelope de erro. |
| scrubbers/log allowlists/Sentry handler | **Estender** | Normalização Store deve ocorrer sem afetar Admin/Webhooks. |
| PaymentAttempt validators/derivação server-side | **Reusar** | Fase 19 adiciona capability/key/version; não reescrever fluxo financeiro. |
| CheckoutCompletionLog | **Reusar como padrão**, não como store genérico | Scope exclusivo do nascimento de Order. |
| módulos customizados com unique constraints | **Reusar padrão** | Novos models requerem migration futura. |
| locking Redis Medusa | **Reusar para coordenação** | Não é verdade de idempotência/concurrency. |
| HTTP integration harness | **Estender** | Precisa matrix nativa/fail-closed e prova Order zero. |
| disposable PostgreSQL harness | **Reusar** | Provar transação e concorrência real; Redis externo deve permanecer isolado. |
| scanners de exemplos/secrets OpenAPI | **Estender** | Incluir key/capability/CPF/provider/correlation. |
| rate limiter tracking in-process | **Não usar transversalmente** | Não é cross-dyno. |

[VERIFIED: codebase e API-DOCS-01]

**Don't hand-roll:** não construir router próprio, workflow engine, cryptografia, JWT/session, cache ou lock distribuído. Usar o router/middleware Medusa, PostgreSQL constraints/transações, locking module configurado, `crypto` server-side e framework auth; customizar apenas manifest, policy, models e adapters que o contrato exige. [VERIFIED: stack/convenções; recomendação HIGH]

## 15. Threat Register

### ASVS aplicável

| Categoria | Aplica | Controle padrão futuro |
|---|---|---|
| V2 Authentication | sim | Medusa auth + policy BFF-only + rotas `/auth` restritas na Phase 14. |
| V3 Session Management | sim | customer session/JWT server-side; capability/confirmation com validade e revogação. |
| V4 Access Control | sim | manifest fail-closed, ownership e não enumeração por operação. |
| V5 Input Validation | sim | validators Zod/Medusa + schemas fechados + fingerprint pós-validação. |
| V6 Cryptography | sim | HMAC/hash/cipher aprovados; nunca hand-roll ou plaintext de tokens. |

[VERIFIED: `.planning/config.json` security enforcement/ASVS L1 e D13]

| ID | Ameaça | STRIDE | Controle atual | Gap | Prova futura |
|---|---|---|---|---|---|
| T1 | rota nativa não classificada contorna policy | Elevation of Privilege | publishable key/CORS | sem allowlist | scan=manifest e HTTP deny total |
| T2 | auth customer ausente/optional indevida | Spoofing/EoP | auth contextual por rota | muitas rotas são optional | matriz ator × rota |
| T3 | guest capability ausente, expirada ou de outro Cart | Spoofing | ainda não existe transversal | boundary de guest aberto | HMAC/hash, expiry, ownership e negative tests |
| T4 | lookup/erro enumera recurso alheio | Information Disclosure | alguns ownership checks locais | erros nativos variam | respostas indistinguíveis e DTO fechado |
| T5 | mesma idempotency key com intenção diferente | Tampering/Replay | CheckoutCompletion só no Order | sem store genérico | fingerprint conflict 409, zero side effect |
| T6 | retries concorrentes duplicam efeito | Replay/DoS | constraints pontuais | sem claim transversal | corrida real PG, um winner e replays |
| T7 | stale Cart causa lost update | Tampering | nenhum ETag/version | sem CAS atômico | dois writers, um 412, estado íntegro |
| T8 | native complete cria Order | EoP/Tampering | nenhum bloqueio | bypass factual | deny + workflow spy + Order count zero |
| T9 | provider/internal error vaza IDs/PII/secret | Information Disclosure | scrubbers/Sentry | Store envelope nativo aberto | canaries + schema closed + logs scan |
| T10 | correlation ID injeta log/deriva token | Spoofing/Repudiation | allowlist 128 chars + UUID | body/error desalinhado | invalid inputs substituted; same safe ID |
| T11 | OpenAPI diverge do runtime | Tampering/Repudiation | coverage parcial | 50 ops fora do contrato | manifest/version drift gate |
| T12 | HEAD/OPTIONS/alias contorna método classificado | EoP | router framework | política ainda ausente | matrix method/path normalization |
| T13 | lock Redis expira e é tratado como verdade | Tampering/DoS | locking module | sem modelo transversal | PG constraint/CAS vence mesmo sem lock |

[VERIFIED: threat model do CONTEXT + codebase; controles propostos INFERRED]

## 16. Migration / DB Model Impact

O desenho recomendado requer **duas persistências customizadas**, possivelmente no mesmo módulo foundation ou em módulos isolados conforme convenção: `StoreIdempotencyRecord` e `StoreResourceVersion`. Cada uma exige model Medusa, migration gerada em gate futuro e atualização prévia do `docs/DB_MODEL_v1.21.md`/versão sucessora. [INFERRED; HIGH]

| Impacto | Necessário | Constraint crítica |
|---|---|---|
| idempotency store | sim | unique scope+key hash; índices state/lock e expiry |
| version store | sim | unique resource; bigint positivo; CAS atômico |
| alterar core Cart table | não recomendado | evita depender de schema interno Medusa |
| alterar CheckoutCompletionLog | não | preservar invariante v1.0 |
| data backfill | provavelmente mínimo para carts ativos, mas não comprovado | estratégia inicial/version=1 deve ser definida sem quebrar carts existentes |
| Redis schema | não | keys de lock são coordenação efêmera, não migração de verdade |

O backfill/bootstrapping de versões para Carts já existentes é uma questão aberta de migration: `INSERT ... ON CONFLICT` lazy com versão 1 pode ser seguro apenas se o primeiro acesso/mutação estiver serializado; alternativa é backfill determinístico. O PLAN deve escolher e testar com dado existente, sem presumir banco vazio. [UNKNOWN controlado]

Não houve acesso a DB/Supabase. Portanto cardinalidade, carts ativos e custo de índices são desconhecidos; não são necessários para autorizar o PLAN, mas são necessários antes de executar migration. [VERIFIED: escopo]

## 17. Package / Dependency Impact

**Recomendação: nenhuma dependência nova e nenhuma alteração de package/lockfile.** Medusa 2.16.0, PostgreSQL/ORM, Node `crypto`, Zod instalado, Jest/test-utils e locking Redis já cobrem os primitives necessários. [VERIFIED: package manifests e node_modules]

`@medusajs/locking-postgres@2.16.0` está presente transitivamente, mas não precisa ser promovido/configurado: a direção usa row lock/conditional update dentro do módulo PostgreSQL e mantém Redis como provider de Locking. [VERIFIED: pacote/config local]

Como nenhuma instalação é recomendada, o Package Legitimacy Gate não se aplica. Qualquer package novo proposto no PLAN deve reabrir pesquisa e legitimacy audit; não há autorização implícita. [VERIFIED: protocolo de pesquisa]

## 18. Downstream Findings Phases 14–21

| Phase | Finding obrigatório do Phase 13 | Não antecipar aqui |
|---:|---|---|
| 14 Auth | Instalação também expõe 18 operações `/auth` em 14 arquivos; não há override local. `/auth` tem CORS, mas não o middleware Store publishable-key. Restringir actor/provider ao contrato customer/emailpass e classificar callback, MFA, token/session/refresh/reset. [VERIFIED: scan instalado/projeto] | implementar auth/verification/reset/refresh |
| 15 Cart | Estender line-items e active-cart atrás de capability, idempotency e ETag; negar create/get/update cart nativos diretos. [VERIFIED: matriz] | capability e mutations |
| 16 Merge | O attach custom atual usa session/transfer e não satisfaz automaticamente merge/review v1.1; rota nativa `/customer` também deve ficar bloqueada. [VERIFIED: código/matriz] | merge/review |
| 17 Checkout | Bloquear update Cart genérico; reutilizar serializer seguro/CPF mascarado e nunca logar CPF cru. [VERIFIED: código/invariantes] | CPF/consentimento/validação |
| 18 Shipping | Bloquear três caminhos nativos de shipping (`shipping-methods`, list, calculate); quote/select precisa capability, TTL e If-Match próprios. [VERIFIED: matriz] | quote/select |
| 19 Payment | Bloquear Payment Collection/Session nativas; somente card integra o PaymentAttempt do Frontend M1 e precisa do hardening específico. Pix permanece `OUTSIDE_FRONTEND_M1`. [VERIFIED: matriz/REQUIREMENTS] | hardening payment |
| 20 Confirmation | Nenhuma Store completa Cart; confirmação assíncrona deve apenas observar o pipeline webhook e usar capability/session server-side. [VERIFIED: Order map] | confirmation session/ops |
| 21 Order/Catalog | Native `/orders/{id}` e transfer routes ficam bloqueadas; order summary deve usar ownership/capability e DTO fechado. Product routes preservam serializer atual. [VERIFIED: matriz] | summary/revalidation |

O inventário `/auth` é carry-forward, não parte das 58 operações `/store`: GET+POST provider; GET+POST callback; register/reset/update; MFA challenge/factors/recovery; session GET/DELETE/POST; token/refresh; verification confirm/request. [VERIFIED: `node_modules/@medusajs/medusa/dist/api/auth`]

## 19. Answers R13-01..R13-16

### R13-01 — Qual é a lista completa de rotas Store nativas efetivamente instaladas no Medusa 2.16.0?

São **51 operações nativas** em 44 arquivos, enumeradas nas linhas 1–51 da matriz da seção 5. Com sete operações locais não sobrepostas, a superfície runtime `/store` totaliza **58**. [VERIFIED: scan estático do pacote instalado e projeto; PROVEN]

### R13-02 — Qual técnica bloqueia ou estende cada rota sem deixar aliases, métodos ou caminhos alternativos?

Manifest TypeScript único, estático e versionado + middleware global `/store*` fail-closed, method-aware e normalizador, executado antes de handlers; overrides somente para semântica `EXTENDED`, `isDisabled` como defesa pontual. Gates cobrem HEAD/OPTIONS/aliases/trailing slash/encoded path e drift do pacote. [SUPPORTED pelo router 2.16.0; direção HIGH]

### R13-03 — Quais rotas nativas podem ser reutilizadas preservando D13-*?

Nenhuma está `AUTHORIZED` as-is. Dez são candidatas `EXTENDED`: três line-item
operations, customer register/me, dois products, dois active-cart locais e card
PaymentAttempt. Todas permanecem fail-closed até habilitação e provas da phase
proprietária. As demais são 17 `BLOCKED` e 31 `OUTSIDE_FRONTEND_M1`, incluindo
Pix. [VERIFIED: matriz; PROVEN classificação]

### R13-04 — Qual mecanismo físico garante CartVersion monotônica, atômica e sem lost update?

Modelo PostgreSQL genérico `StoreResourceVersion` com `bigint`, unique por
recurso, row lock/conditional update e transação compartilhada com uma mutação
Medusa controlada. A Phase 13 entrega o primitive e a prova Wave 0; a Phase 15
integra Cart, ETag, If-Match, `CART_VERSION_MISMATCH`, snapshot e invalidação.
Redis pode serializar contenção, mas não é fonte de correção. [INFERRED/SUPPORTED;
primitive BLOCKED se a prova falhar]

### R13-05 — Qual schema físico representa o idempotency store transversal?

`StoreIdempotencyRecord` com hashes de operação/ator/recurso/key, fingerprint canônico, máquina de estados, resultado allowlisted, timestamps/expiry e unique composto. Claims/replays são transacionais em PostgreSQL e nunca persistem key/token/capability/PII puros. [INFERRED; atende D13-13..D13-19]

### R13-06 — Qual TTL/retenção por operação é necessário e canônico?

Não existe valor genérico comprovado. O contrato deve usar `expires_at` e policy map por operação, cobrindo a janela de retry/resultado incerto do BFF e permanecendo finito/minimizado. **Número exato: UNKNOWN/pending decisão humana por operação**; não reutilizar TTLs de outros domínios. [UNKNOWN; não bloqueia o PLAN, bloqueia implementação sem decisão]

### R13-07 — Quais controles pertencem a PostgreSQL e quais a Redis?

PostgreSQL: unique claims, fingerprint/result state, versions, CAS, row locks, ownership truth e reconciliation. Redis: locking curto cross-dyno/coordenação e infraestrutura Medusa já configurada. In-memory: nunca para corretude. [VERIFIED/SUPPORTED; HIGH]

### R13-08 — Qual locking/constraint complementa idempotência e optimistic concurrency?

Unique scope+key para idempotência; unique resource e `UPDATE ... WHERE version=expected` para concurrency; transaction/row lock para atomicidade; Redis lock opcional por recurso para contenção. Nenhum mecanismo substitui os demais. [INFERRED; alinhado a D13-18]

### R13-09 — Quais hooks/primitives do Medusa 2.16.0 são adequados e quais criam bypass?

Adequados: `defineMiddlewares`, matcher global, auth/publishable context, serializers/validators, modules/workflows, shared transaction context e Locking module. Override/disable de route é defesa localizada. Bypass factual: `POST /store/carts/{id}/complete`; também são perigosos os atalhos nativos de Cart, Payment Collection/Session, shipping, Order transfer e scaffold. [VERIFIED: fonte instalada; PROVEN]

| Primitive | Available? | Where used today? | Fit | Risk | Recommendation |
|---|---|---|---|---|---|
| Store routing | Sim, no router/framework 2.16.0. [VERIFIED: pacote instalado] | Carrega as 51 operações nativas e as rotas locais `/store`. [VERIFIED: pacote/codebase] | Boundary HTTP apropriado para aplicar política antes dos handlers. [SUPPORTED] | Ordenação, normalização, aliases e métodos implícitos precisam de prova. [INFERRED] | Manter o router Medusa e inserir guard manifest-driven global; não criar router paralelo. |
| Route middleware | Sim, via `defineMiddlewares`, matcher e filtro de métodos. [VERIFIED: pacote instalado] | `apps/backend/src/api/middlewares.ts` estende products, Cart, customer, payment e Admin. [VERIFIED: codebase] | Primitive principal do lockdown e de extensões específicas. [SUPPORTED] | Matchers específicos atuais não formam allowlist global; método omitido/aplicado incorretamente pode abrir bypass. [VERIFIED/INFERRED] | Um matcher `/store*` sem filtro de método para classificação, seguido de middlewares específicos. |
| Auth middleware | Sim, `authenticate` required/optional e contexto publishable-key/customer. [VERIFIED: pacote instalado] | Rotas customer/order e matchers locais usam auth required/optional; Store recebe publishable-key global. [VERIFIED: codebase/pacote] | Identifica ator e mecanismo de sessão/JWT. [SUPPORTED] | Não substitui ownership, capability, BFF-only nem classificação; várias rotas nativas são optional. [VERIFIED] | Reusar identidade nativa, mas exigir policy/ownership/capability por entrada do manifest. |
| Request validation | Sim, validators Medusa e Zod/local middleware. [VERIFIED: pacote/codebase] | Products query, active Cart, attach e PaymentAttempt já possuem validação/rejeição de money fields. [VERIFIED: codebase] | Produz input semântico antes de fingerprint e handler. [SUPPORTED] | Fingerprint sobre payload cru gera divergência artificial; validator nativo pode aceitar campos fora do DTO público. [INFERRED] | Validar e reduzir ao DTO público primeiro; canonicalizar somente campos semânticos. |
| Workflows | Sim, engine/workflows Medusa. [VERIFIED: pacote instalado] | Webhook→Order, PaymentAttempt e demais pipelines locais; rota native complete também chama workflow. [VERIFIED: codebase/pacote] | Orquestração durável dos fluxos aprovados. [SUPPORTED] | Workflow reutilizado por entrypoint indevido continua sendo bypass; primitive não concede autorização. [VERIFIED] | Expor workflows somente por entrypoints classificados; bloquear Store complete antes da invocação. |
| Transaction boundaries/sharedContext | Disponível nos services/tipos 2.16.0 e documentado oficialmente. [VERIFIED: pacote instalado; CITED: docs Medusa] | Usado internamente por services/workflows; ainda não existe prova Phase 13 de mutação Medusa + version model. [VERIFIED: codebase] | Candidato a commit atômico genérico entre mutação Medusa controlada e version model. [SUPPORTED, não PROVEN] | Atomicidade cross-module/transaction manager não foi demonstrada neste repo. [UNKNOWN] | Wave 0 obrigatória; se não compartilhar a mesma transação, marcar o primitive BLOCKED; integração Cart fica na Phase 15. |
| Module services | Sim, módulos Medusa customizados e core. [VERIFIED: codebase/pacote] | PaymentAttempt, CheckoutCompletion, checkout e demais módulos v1.0. [VERIFIED: codebase] | Boundary correto para os models idempotency/version e regras persistentes. [SUPPORTED] | Importar service de outro módulo ou alcançar DB alheio viola isolamento. [VERIFIED: arquitetura Medusa/projeto] | Criar service próprio e usar container/workflow/query para integração. |
| Remote query / `query.graph` | Sim. [VERIFIED: pacote instalado] | `remoteQuery` em active Cart, attach, card/Pix e tracking; `query.graph` em catálogo e Order webhook. [VERIFIED: codebase] | Leitura allowlisted entre módulos/links sem acesso direto ao DB alheio. [SUPPORTED] | Expandir fields/relations pode vazar dados ou tornar ownership implícito. [INFERRED] | Centralizar field sets fechados e nunca usar query como substituto de autorização/transação. |
| Route extension/override | Sim; middleware estende rota e loader admite sobreposição por path. [VERIFIED: pacote instalado] | Products são extensões nativas por middleware; não há lockdown global por override. [VERIFIED: codebase] | Pode apoiar as 10 operações `EXTENDED`, sem habilitá-las por si só. [SUPPORTED] | Um override por rota é frágil para inventário completo e pode derivar em upgrades. [INFERRED] | Guard global como controle primário; override somente para semântica/DTO da operação e habilitação controlada pela phase proprietária. |
| Locking | Sim; módulo Locking com provider Redis configurado e API `execute/acquire/release`. [VERIFIED: config/pacote] | Infraestrutura Redis registrada; não há primitive transversal Phase 13 implementado. [VERIFIED: codebase] | Coordenação curta cross-dyno por recurso. [SUPPORTED] | Expiry/falha Redis não prova exclusão permanente nem resultado de side effect. [VERIFIED/INFERRED] | Reusar apenas para contenção; PostgreSQL unique/CAS permanece fonte de verdade. |
| Idempotency primitive | Parcial: workflow `context.idempotencyKey`; CheckoutCompletionLog é custom e específico. [VERIFIED: pacote/codebase] | Nascimento de Order reutiliza CheckoutCompletionLog; não há registro Store transversal. [VERIFIED: codebase] | Workflow key pode estabilizar uma execução interna. [SUPPORTED] | Não cobre sozinho scope operação+ator+recurso, fingerprint semântico, replay HTTP ou retenção D13. [VERIFIED: gap contra D13] | Criar `StoreIdempotencyRecord`; usar workflow idempotency somente como camada interna complementar. |
| Store route exposure/disable | Sim, exposição file-based e `defineFileConfig({isDisabled:true})` no loader. [VERIFIED: pacote instalado] | Nenhuma política de disable/allowlist Store global está aplicada; `/store/custom` continua exposta. [VERIFIED: codebase] | Defesa em profundidade para handlers pontuais, especialmente native complete. [SUPPORTED] | Controle file-level não classifica aliases/métodos nem detecta automaticamente rota nova. [INFERRED] | Desabilitar/override pontual quando útil, mas exigir manifest+guard+drift test como controle canônico. |

### R13-10 — Será necessária migration; em quais módulos e com quais constraints?

Sim, para `StoreIdempotencyRecord` e `StoreResourceVersion` em módulo(s) customizado(s). Constraints: unique de scope+key hash; índices state/locked/expiry; unique resource; `version > 0`. Não alterar CheckoutCompletionLog/core Cart sem prova. Estratégia de inicialização de carts existentes permanece aberta. [INFERRED; HIGH]

### R13-11 — Como compatibilizar erros nativos com o envelope público?

Adapter Store no error handler global existente, após scrub/capture, mapeando erro nativo/domain/auth/validation a códigos/status públicos fechados e correlation ID sanitizado; desconhecidos/provider viram código genérico. Guard global impede respostas nativas precoces nas operações classificadas; Admin/Webhooks continuam delegados. [SUPPORTED pela ordem do router; HIGH]

### R13-12 — Quais schemas/headers/security schemes entram na fundação OpenAPI?

`StoreErrorResponse`, catálogo de códigos/status, `Idempotency-Key`, `If-Match`, `ETag`, `x-correlation-id`, `Retry-After` condicionado, money major/minor BRL fechados e schemes BFF→Medusa existentes/explicitados. Guest capability/confirmation só entram como primitive quando fechadas, sem operações futuras. Target `1.1.0` via registry. [VERIFIED: D13-25..D13-29 e registry]

### R13-13 — Como o coverage gate representa as quatro classificações?

Manifest único contém classificação exata por método/path e versão Medusa.
`AUTHORIZED` e `EXTENDED` explicitamente habilitada exigem operação registry +
guard/test; `EXTENDED` não habilitada, `BLOCKED` e `OUTSIDE` exigem deny test.
Scan instalado divergente, entrada duplicada ou desconhecida falha. [INFERRED;
HIGH]

### R13-14 — Qual prova negativa demonstra que nenhuma Store cria Order?

Combinar scan estático, HTTP deny de toda matriz/aliases, spy do workflow de completar Cart, Order count zero em PostgreSQL descartável e controle positivo/replay do webhook canônico. Teste atual isolado não cobre o endpoint nativo completo. [VERIFIED gap; estratégia INFERRED/HIGH]

### R13-15 — Há impacto adicional do Medusa 2.16.0 em auth/store para Phases 14–21?

Sim: 18 operações `/auth` instaladas e sem override local; `/auth` não herda publishable-key Store. Phase 14 deve classificar/restringir actor/provider e rotas session/token/MFA/verification. As rotas Store nativas de shipping/payment/order/cart indicadas precisam permanecer negadas até suas phases. [VERIFIED: pacote/projeto; PROVEN]

### R13-16 — Alguma alteração de package/dependency é necessária?

Não. Nenhuma nova dependência é necessária ou recomendada; package/lockfile ficam intocados. Se um PLAN futuro propuser pacote, deve reabrir legitimacy audit e autorização. [VERIFIED: manifests e capacidades instaladas; HIGH]

## 20. Recommended Planning Direction

### Standard stack prescritivo

| Tecnologia | Versão as-built | Uso na Phase 13 | Evidência |
|---|---|---|---|
| Node.js | `>=22 <23` | crypto/hash, runtime existente | package manifest [PROVEN] |
| TypeScript | pin do workspace | manifest/policy/registry | package manifest [PROVEN] |
| Medusa | `2.16.0` matched set | router, middleware, modules, workflows, Locking | manifests/source [PROVEN] |
| PostgreSQL | infraestrutura existente | verdade idempotency/version/constraints | config/arquitetura [PROVEN] |
| Redis Locking | provider Medusa 2.16.0 | coordenação curta | `medusa-config.ts` [PROVEN] |
| Zod | `4.2.0` instalado | validação/canonicalização antes de fingerprint | package manifest [PROVEN] |
| Jest/test-utils | Jest `^29.7.0`, Medusa `2.16.0` | provas unit/HTTP/PG futuras | package manifest [PROVEN] |

**Installation:** nenhuma. **Publish dates verificados:** Medusa/framework 2.16.0 em 2026-06-18. Não migrar para o latest durante esta phase. [VERIFIED: npm registry e pin local]

### Boundary de materialização

A Phase 13 pode materializar somente fundação transversal: manifest Store,
lockdown global fail-closed, primitive de erro Store, primitives genéricos de
idempotência e resource-version/optimistic concurrency, feasibility/transaction
proofs, componentes OpenAPI 1.1.0 transversais, gates runtime/OpenAPI e provas
negativas de native-route e Order-birth bypass.

A Phase 13 não deve materializar antecipadamente o comportamento final de auth,
guest capability, line items/Cart, merge, CPF/checkout, shipping quote/select,
PaymentAttempt M1, confirmação assíncrona, Order summary ou catalog
revalidation. Essas responsabilidades permanecem nas Phases 14–21. O PLAN pode
criar primitives e technical harnesses de viabilidade, sem converter rotas
downstream em contratos M1 prontos.

### Sequência recomendada para um PLAN futuro

1. **Wave 0:** snapshot scanner do pacote 2.16.0, prova de ordem do guard,
   prova de transação compartilhada entre mutação Medusa controlada +
   `StoreResourceVersion` e harnesses concorrentes genéricos. [INFERRED]
2. Criar manifest único com as 58 entradas e coverage fail-closed; implementar
   guard global e negar imediatamente `EXTENDED` não habilitada, `complete`,
   scaffold e todas as `BLOCKED/OUTSIDE`. [INFERRED]
3. Normalizar erro Store/correlation sem mudar Admin/Webhooks. [INFERRED]
4. Materializar models/migrations idempotency/version, com DB model docs e decisão humana de retenção/bootstrapping. [INFERRED]
5. Provar genericamente claim/fingerprint, CAS/atomic increment e viabilidade
   transacional dos primitives, sem integrar comportamento final às operações
   `EXTENDED` das Phases 14–21. [INFERRED]
6. Atualizar registry para primitives `1.1.0`, gerar/revisar/lintar em gate escritor e executar `openapi:check` depois em checkout limpo. [VERIFIED: API Docs contract]
7. Fechar provas negative Order birth, concorrência, sensitive scan e drift; então parar no manual gate. [VERIFIED: critérios]

### Common pitfalls

| Pitfall | Consequência | Prevenção |
|---|---|---|
| Confundir publishable key/CORS com autorização | browser/native bypass | manifest+actor/capability/ownership |
| Autorizar path sem método | HEAD/alternate method bypass | chave método+template e matrix |
| Usar Redis/in-memory como verdade | duplicata/lost update após expiry/restart | PG unique/CAS |
| Salvar resposta inteira de idempotência | PII/token/client_secret durável | snapshot allowlisted/rederivável |
| Usar `updated_at` como version | não monotônico/não atômico | bigint server-authoritative |
| Dois commits Cart/version | mutação sem versão ou vice-versa | transação compartilhada ou BLOCKED |
| Converter toda rota nativa em override | superfície difícil de provar | guard global + overrides mínimos |
| Gerar OpenAPI dentro do check | mascara drift | writer e read-only check separados |

### Planning recommendation matrix

| Topic | Recommendation | Evidence strength | PLAN implication |
|---|---|---|---|
| Store lockdown | Aplicar guard global `/store*` fail-closed, method/path-aware, consumindo manifest único. | SUPPORTED pela ordem do router 2.16.0; comportamento final ainda requer teste. | Wave de foundation antes de qualquer operação downstream; unknown, `EXTENDED` não habilitada, blocked e outside sempre negados. |
| Route classification artifact | Criar manifest TypeScript versionado para as 58 operações, com classificação, origem, razão, guard e expectativa OpenAPI. | PROVEN quanto ao inventário; formato recomendado INFERRED. | Mesmo artefato alimenta runtime guard, coverage e drift; nenhuma lista paralela. |
| Error mapping | Adaptar o error handler existente somente para Store ao envelope fechado e correlation ID sanitizado. | PROVEN quanto ao gap; integração SUPPORTED. | Preservar Sentry scrub e delegação Admin/Webhooks; testes de todos os status/canaries. |
| Idempotency persistence | Persistir `StoreIdempotencyRecord` em PostgreSQL com hashes, fingerprint, estado, resultado seguro e `expires_at`. | INFERRED a partir de D13-13..D13-19. | Model + migration + DB model doc; checkpoint humano para TTL por operação. |
| Idempotency claim/concurrency | Claim transacional sob unique scope+key; same intent replay, incompatible intent 409, uncertain effect reconciliation. | INFERRED; constraints PostgreSQL são padrão suportado. | Testes concorrentes reais, não apenas sequenciais; Redis não decide winner. |
| Resource version storage | Persistir `StoreResourceVersion.version bigint` server-authoritative, unique por recurso. | INFERRED; gap atual PROVEN. | Phase 13 entrega model + migration + prova genérica e escolhe bootstrap/backfill; integração Cart permanece na Phase 15. |
| ETag primitive | Definir representação forte/opaca derivada da identidade e versão retornada pelo servidor. | INFERRED, vinculado a D13-20/D13-21. | Phase 13 define primitive/componente e harness; serializer público de Cart pertence à Phase 15. |
| If-Match/CAS primitive | Provar comparação server-authoritative e CAS stale sem mutação. | VERIFIED como decisão D13; mecanismo INFERRED. | Phase 13 prova o primitive; `412 CART_VERSION_MISMATCH`, snapshot e semântica pública de Cart pertencem à Phase 15. |
| PostgreSQL locking | Usar transação compartilhada, row lock/conditional update e constraints como verdade. | SUPPORTED; atomicidade cross-module não PROVEN. | Wave 0 genérica binária; falha em compartilhar transaction manager bloqueia implementação do primitive. |
| Redis usage | Manter Locking Redis apenas para coordenação curta cross-dyno. | PROVEN quanto à disponibilidade/config; papel recomendado INFERRED. | Nenhuma nova infra/dependência; testes devem provar correção mesmo sem assumir lock durável. |
| OpenAPI components | Registry 1.1.0 com StoreErrorResponse, money major/minor BRL, Idempotency-Key, If-Match, ETag, correlation e Retry-After condicionado. | PROVEN quanto ao gap/decisões; composição final SUPPORTED. | Não antecipar endpoints 14–21; writer/lint e check read-only em gates separados. |
| Native route negative tests | Exercitar as 58 entradas, unknown, HEAD/OPTIONS, aliases, trailing slash e encoded paths. | INFERRED a partir do threat model e inventário PROVEN. | Coverage HTTP obrigatório para FND-01/FND-02; qualquer entrada não classificada falha. |
| Order-birth negative proof | Combinar scan, deny HTTP, spy do complete workflow, Order count zero e controle positivo webhook/replay. | Bypass PROVEN; estratégia de prova SUPPORTED. | Gate binário: qualquer chamada Store ao workflow ou Order persistido mantém BLOCKED. |
| Migration need | Criar migrations para idempotency e version model; não alterar core Cart/CheckoutCompletion sem prova. | INFERRED; necessidade deriva dos requisitos persistentes. | Atualizar DB model antes da migration; incluir bootstrap e rollback/recovery local. |
| New dependencies | Não adicionar pacote; usar stack instalada Medusa/PostgreSQL/Redis/Zod/Node crypto. | PROVEN pelos manifests e primitives disponíveis. | Package/lockfile fora do diff; proposta futura exige nova pesquisa e legitimacy gate. |

## 21. Blockers / Risks

### Blockers factuais do estado as-built

| ID | Blocker | Efeito |
|---|---|---|
| B13-01 | `POST /store/carts/{id}/complete` executa completeCart e cria Order. | Viola D13-06; phase as-built **BLOCKED**. |
| B13-02 | Não existe allowlist global; 50 operações `/store` runtime estão fora do OpenAPI. | Superfície não é fail-closed. |
| B13-03 | `/store/custom` executa 200 embora esteja só excluída do contrato. | Bypass/scaffold público. |
| B13-04 | Não existe idempotency store transversal persistido. | FND-04/FND-05 abertos. |
| B13-05 | Não existe version monotônica/ETag/If-Match. | FND-06 aberto/lost-update possível. |
| B13-06 | `StoreError` atual não é o envelope alvo e auth pode responder formato nativo. | FND-03 aberto. |
| B13-07 | Contrato permanece 1.0.0 e sem primitives 1.1.0. | FND-08 aberto. |

[VERIFIED: codebase/pacote]

### Riscos/decisões que o PLAN deve fechar

| Risco | Evidence strength | Tratamento |
|---|---|---|
| Transação compartilhada entre mutação Medusa controlada + version model | SUPPORTED, não PROVEN | Wave 0 genérica; falha = primitive/implementação BLOCKED. Integração Cart permanece na Phase 15. |
| TTL exato por operação | UNKNOWN deliberado | checkpoint humano antes de model/cleanup final. |
| Bootstrap/version de carts existentes | UNKNOWN sem DB | escolher lazy serializado ou backfill e testar migration. |
| Semântica exata de capability/confirmation | deferida | não antecipar; interfaces mínimas só após phase proprietária. |
| Upgrade Medusa alterar surface | risco controlado | pin 2.16.0 + drift gate; upgrade reabre inventário. |

### Disposição humana do desvio processual

| ID | Disposição | Efeito |
|---|---|---|
| PD13-01 | **ACCEPTED PROCESS DEVIATION** — severidade exclusivamente processual; audit trail preservado; sem cleanup e sem autorização destrutiva. | **HUMAN ACCEPTED / NON-BLOCKING**. Findings técnicos permanecem válidos; não repetir `research-store` em futuro gate read-only sem autorização explícita. |

Ambiente local confirmou Node/npm e `node_modules`, mas DB, Redis e providers não foram sondados por proibição de runtime. Isso não bloqueia escrever PLAN; exige isolamento explícito antes de testes futuros. [VERIFIED: escopo/checagens read-only]

**Assumptions log:** vazio. Nenhuma afirmação não verificada foi promovida a fato; recomendações estão marcadas `INFERRED`, e valores desconhecidos permanecem `UNKNOWN`. [VERIFIED: revisão deste documento]

## 22. Validation Strategy for Future PLAN

Nenhum comando abaixo foi executado neste RESEARCH. A validação Nyquist está habilitada e o PLAN deve tornar cada requisito comprovável em menos de 30 segundos no ciclo rápido, reservando integração completa para wave/phase gate. [VERIFIED: `.planning/config.json`]

### Test framework

| Propriedade | Valor |
|---|---|
| Framework | Jest `^29.7.0` + `@medusajs/test-utils@2.16.0` |
| Config | `apps/backend/jest.config.js`/config existente |
| Quick run futuro | `npm run test:unit -- <arquivo>` em `apps/backend` |
| HTTP suite | `npm run test:integration:http -- <arquivo>` |
| Module suite | `npm run test:integration:modules -- <arquivo>` |
| OpenAPI lint futuro | `npm run openapi:lint` |
| Read-only final futuro | `npm run openapi:check` em checkout limpo |

[VERIFIED: `apps/backend/package.json`]

### Requirement → test map

| Req | Comportamento | Tipo | Arquivo/command futuro | Existe? |
|---|---|---|---|---|
| FND-01 | snapshot 58/classificação completa/drift | unit/source scan | `store-surface-manifest.unit.spec.ts` | ❌ Wave 0 |
| FND-02 | deny de blocked/outside/unknown e Order zero | HTTP + PG | `store-surface-lockdown.spec.ts`, `store-order-birth-negative.spec.ts` | ❌ Wave 0 |
| FND-03 | envelope/status/correlation/redaction | unit + HTTP | `store-error-contract.spec.ts` | ❌ Wave 0 |
| FND-04 | claim/replay/expiry seguro | module/PG | `store-idempotency.spec.ts` | ❌ Wave 0 |
| FND-05 | payload conflict + race concorrente | module/PG | `store-idempotency-concurrency.spec.ts` | ❌ Wave 0 |
| FND-06 | primitive genérico `StoreResourceVersion`, CAS atômico, transação compartilhada com mutação Medusa controlada e correção sob writers concorrentes | module/PG harness | `store-resource-version.spec.ts` | ❌ Wave 0 |
| FND-07 | BFF schemes/headers e browser direto negado | contract + HTTP | API-docs security + boundary spec | extensão necessária |
| FND-08 | 1.1.0, money, errors, headers, drift | unit/OpenAPI | API-docs contract/coverage specs | extensão necessária |

### Provas transversais obrigatórias

- matrix de todas as 58 operações e métodos alternativos, incluindo `HEAD`, `OPTIONS`, trailing slash, encoded path e unknown; [INFERRED]
- duas requisições concorrentes com mesma key/same fingerprint, mesma key/different fingerprint e keys diferentes; [VERIFIED: D13-19]
- dois writers genéricos com a mesma expected version: exatamente um commit e
  um conflito CAS sem mutação; o contrato público `If-Match`/`412` de Cart será
  integrado na Phase 15; [VERIFIED: D13-20..D13-24/D13-28]
- falha/timeout entre side effect e response produz replay seguro ou reconciliation, nunca duplicata; [INFERRED]
- canaries de key, JWT, capability, CPF, provider IDs, `client_secret` e stack ausentes de response/log/Sentry/OpenAPI; [VERIFIED: security constraints]
- OpenAPI writer executado somente no gate escritor, diff revisado, lint; depois checkout limpo e `openapi:check` read-only. [VERIFIED: API Docs contract]

### Sampling rate futuro

- Por task commit: teste unitário focal + `tsc`/lint somente se autorizados no PLAN.
- Por wave: suites unit/module/HTTP afetadas.
- Phase gate: full suite aprovada, generation/lint separados, checkout limpo e `openapi:check`, além de manual review.

### Wave 0 gaps

- [ ] scanner/snapshot da superfície Medusa 2.16.0;
- [ ] prova da precedência do guard para erro/auth/route;
- [ ] prova de transação compartilhada entre mutação Medusa controlada +
      version model;
- [ ] fixtures concorrentes PostgreSQL e isolamento Redis;
- [ ] harness de zero `Order` por Store e controle positivo webhook;
- [ ] decisão humana documentada de TTL e bootstrap.

## 23. Sources / Evidence

### Primary — HIGH confidence

- `.planning/phases/13-storefront-contract-foundation-surface-lockdown/13-CONTEXT.md`, `.planning/REQUIREMENTS.md`, ROADMAP/STATE/MILESTONES — escopo e decisões. [VERIFIED: codebase]
- `docs/PRD_Backend_v1.1.md`, `docs/PRD_frontend_v1.1.md`, `docs/SRS_v1.5.md`, `docs/DB_MODEL_v1.21.md`, `docs/FRONTEND_CONTRACT_TRACEABILITY.md` — contratos alvo e invariantes. [VERIFIED: codebase]
- `apps/backend/src/api/**`, `apps/backend/src/modules/{payment-attempt,checkout-completion,checkout}/**`, `medusa-config.ts` — guards e caminho canônico. [VERIFIED: codebase]
- `apps/backend/src/api-docs/**` e `.planning/initiatives/api-docs-openapi-swagger/**` — contrato/coverage atual. [VERIFIED: codebase]
- `apps/backend/node_modules/@medusajs/medusa/dist/api/store/**` — inventário 51 e rota complete. [VERIFIED: pacote instalado 2.16.0]
- `apps/backend/node_modules/@medusajs/framework/dist/http/**` — ordem do router/middleware/route loader. [VERIFIED: pacote instalado 2.16.0]
- `apps/backend/package.json` e lockfile — versões. [VERIFIED: npm manifests]

### Official — MEDIUM confidence, version relevance explicitada

- [Medusa router source](https://github.com/medusajs/medusa/blob/v2.16.0/packages/core/framework/src/http/router.ts) — confirmação oficial da arquitetura de routing; tag exata 2.16.0. [CITED: github.com/medusajs/medusa]
- [Medusa native complete route](https://github.com/medusajs/medusa/blob/v2.16.0/packages/medusa/src/api/store/carts/%5Bid%5D/complete/route.ts) — workflow de complete Cart; tag exata 2.16.0. [CITED: github.com/medusajs/medusa]
- [Locking Redis](https://github.com/medusajs/medusa/blob/develop/www/apps/resources/app/infrastructure-modules/locking/redis/page.mdx) e [Locking PostgreSQL](https://github.com/medusajs/medusa/blob/develop/www/apps/resources/app/infrastructure-modules/locking/postgres/page.mdx) — providers e interface; docs `develop`, usadas apenas como apoio, fonte instalada prevalece. [CITED: github.com/medusajs/medusa]
- [Module DB operations / transaction context](https://github.com/medusajs/medusa/blob/develop/www/apps/book/app/learn/fundamentals/modules/db-operations/page.mdx) — shared transaction manager; docs `develop`, atomicidade local ainda exige Wave 0. [CITED: github.com/medusajs/medusa]
- npm registry — `@medusajs/medusa@2.16.0` e `@medusajs/framework@2.16.0`, publicação 2026-06-18. [VERIFIED: npm registry]

### External official-source conclusion ledger

A fonte local instalada 2.16.0 continua prevalecendo para todo comportamento executável. Fontes `develop/current` sustentam somente disponibilidade/intenção do primitive e não promovem comportamento futuro a fato da versão instalada. [VERIFIED: protocolo desta pesquisa]

| Source | Version relevance | Conclusion |
|---|---|---|
| [Medusa router source, tag v2.16.0](https://github.com/medusajs/medusa/blob/v2.16.0/packages/core/framework/src/http/router.ts) | **Exata: 2.16.0**; confirma a mesma linha do pacote instalado. | Router compõe middlewares e rotas ordenados; suporta a direção de guard global, sem substituir testes locais de precedência. [CITED: github.com/medusajs/medusa] |
| [Native complete route, tag v2.16.0](https://github.com/medusajs/medusa/blob/v2.16.0/packages/medusa/src/api/store/carts/%5Bid%5D/complete/route.ts) | **Exata: 2.16.0**; corroborada pelo `route.js` instalado. | `POST /store/carts/{id}/complete` invoca o workflow de complete Cart e constitui bypass de nascimento de Order. [CITED: github.com/medusajs/medusa] |
| [Locking Redis docs](https://github.com/medusajs/medusa/blob/develop/www/apps/resources/app/infrastructure-modules/locking/redis/page.mdx) | `develop/current`, não garantia de detalhes 2.16.0; API/config local instalada prevalece. | Medusa oferece provider Redis para Locking; nesta pesquisa ele é recomendado apenas para coordenação curta. [CITED: github.com/medusajs/medusa] |
| [Locking PostgreSQL docs](https://github.com/medusajs/medusa/blob/develop/www/apps/resources/app/infrastructure-modules/locking/postgres/page.mdx) | `develop/current`; presença transitiva 2.16.0 foi verificada localmente, mas provider não está configurado. | Existe alternativa oficial PostgreSQL para o módulo Locking; não há razão demonstrada para trocar o provider atual nesta phase. [CITED: github.com/medusajs/medusa] |
| [Module DB operations / transaction context](https://github.com/medusajs/medusa/blob/develop/www/apps/book/app/learn/fundamentals/modules/db-operations/page.mdx) | `develop/current`; tipos/services locais 2.16.0 confirmam `sharedContext`, mas atomicidade cross-module permanece não provada. | O transaction manager compartilhado é o caminho oficial candidato; Wave 0 deve provar mutação Medusa controlada + version model em um único commit. A integração Cart pertence à Phase 15. [CITED: github.com/medusajs/medusa] |
| [npm registry: `@medusajs/medusa@2.16.0`](https://www.npmjs.com/package/@medusajs/medusa/v/2.16.0) e [`@medusajs/framework@2.16.0`](https://www.npmjs.com/package/@medusajs/framework/v/2.16.0) | **Exata: 2.16.0**; manifests locais fixam essa versão. | Os packages/versionados existem e foram publicados em 2026-06-18; versão mais nova não autoriza upgrade nesta phase. [VERIFIED: npm registry] |

### Confidence breakdown

| Área | Nível | Razão |
|---|---|---|
| Surface inventory | HIGH | fonte executável instalada, contagem e matriz completas |
| Order bypass | HIGH | handler instalado chama workflow diretamente |
| Lockdown architecture | HIGH | ordem do router comprovada; precisa testes de aliases |
| Error/OpenAPI gap | HIGH | registry e handler locais |
| Idempotency physical design | MEDIUM | desenho prescritivo; migration/concurrency ainda não executadas |
| Optimistic concurrency | MEDIUM | primitives disponíveis; transação cruzada precisa Wave 0 |
| TTL/bootstrap | LOW/UNKNOWN | decisão deliberadamente não inventada |
| Package impact | HIGH | capacidades/manifests instalados, nenhuma adição |

**Research date:** 2026-08-07. **Valid until:** enquanto o pin Medusa permanecer 2.16.0 e a superfície local não mudar; qualquer upgrade/rota/middleware novo invalida as contagens imediatamente. [VERIFIED: natureza versionada do inventário]

## 24. Manual Review Gate

### Critério READY/BLOCKED

| Gate | Resultado | Razão |
|---|---|---|
| Artefato de RESEARCH | **COMPLETE / AWAITING HUMAN RE-REVIEW** | R13-01..R13-16 respondidas; 58/58 operações classificadas; 0 desconhecidas; correções R1 aplicadas. |
| Estado as-built da Phase 13 | **BLOCKED** | Bypass nativo cria `Order`, não há allowlist, models transversais, concurrency primitive nem OpenAPI 1.1.0. |
| PD13-01 | **HUMAN ACCEPTED / NON-BLOCKING** | Desvio histórico exclusivamente processual; audit trail preservado e findings técnicos válidos. |
| Research blockers requiring new investigation | **0** | TTL, bootstrap e atomicidade cruzada já têm tratamento explícito de PLAN/Wave 0 e não exigem nova pesquisa externa agora. |
| PLAN readiness | **READY FOR HUMAN REVIEW / EXPLICIT PLAN AUTHORIZATION** | A pesquisa técnica está completa; os blockers as-built são o objeto esperado de um PLAN futuro. |
| PLAN | **NOT AUTHORIZED neste gate** | exige nova autorização humana após revisão deste arquivo. |
| Implementation/verification/review/closure/deploy/frontend | **NOT AUTHORIZED** | fora do escopo e da progressão atual. |

Unknowns não foram suavizados: TTL exato, bootstrap de versões e transação cruzada estão explicitamente pendentes; a última é blocker de execução se a prova Wave 0 falhar. Esses unknowns não impedem um PLAN de incluir checkpoints e caminhos binários. [VERIFIED: critérios do pedido]

```text
Technical research: COMPLETE
R13-01..R13-16: ANSWERED
Store surface: 58/58 classified
Unclassified relevant routes: 0
PD13-01: HUMAN ACCEPTED / NON-BLOCKING
Research blockers requiring new investigation: 0
As-built Phase 13 readiness: BLOCKED
PLAN readiness: READY FOR HUMAN REVIEW / EXPLICIT PLAN AUTHORIZATION
Phase 13 PLAN: NOT STARTED / NOT AUTHORIZED
Implementation: NOT AUTHORIZED
Frontend Milestone 1: BLOCKED
```

**Próximo passo permitido:** revisão humana do `P13-RESEARCH-R1`. Não iniciar
PLAN sem nova autorização explícita.
