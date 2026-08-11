---
phase: 13-storefront-contract-foundation-surface-lockdown
milestone: v1.1-backend-storefront-readiness
status: context-complete-awaiting-human-review
created_at: 2026-08-07
scope: context-only
requirements: [FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07, FND-08]
manual_review_gate: true
branch: gsd/phase-13-storefront-contract-foundation-surface-lockdown
research_status: not-started-not-authorized
plan_status: not-started-not-authorized
implementation_status: not-authorized
---

# Phase 13: Storefront Contract Foundation & Surface Lockdown — Context

**Gathered:** 2026-08-07
**Status:** CONTEXT complete / awaiting human review
**Next permitted step:** human review of this CONTEXT; RESEARCH remains blocked

<domain>
## 1. Phase Identity and Boundary

**Milestone:** `v1.1 — Backend Storefront Readiness`
**Phase:** `13 — Storefront Contract Foundation & Surface Lockdown`
**Sequence:** `13 → 14 → 15 → 16 → 17 → 18 → 19 → 20 → 21 → 22`

### Goal

Conhecer, classificar e controlar a superfície Store real exposta pela versão
Medusa instalada antes de adicionar os contratos do Frontend M1, garantindo
que nenhuma rota nativa ou customizada incompatível contorne autenticação,
guest capability, ownership, concorrência, checkout, pagamento ou a regra
fundamental de criação de `Order`.

### Scope of this gate

Este artefato fecha somente decisões e contexto para `FND-01..FND-08`. Ele não
implementa inventário final, allowlist, bloqueios, schemas, persistência,
OpenAPI `1.1.0`, testes ou qualquer operação das Phases 14–22.

</domain>

## 2. Threat Model

A Phase 13 futura deve eliminar, com evidência verificável, as ameaças abaixo.
Este gate apenas fixa o modelo; não implementa mitigação.

| Threat | Exemplo | Resultado proibido |
|---|---|---|
| Elevation of Privilege | rota Medusa nativa ignora guard customizado | ator ganha capacidade além do contrato autorizado |
| Tampering | stale cart sobrescreve atualização mais nova | lost update ou snapshot financeiro incompatível |
| Replay | reutilização indevida de `Idempotency-Key` | efeito repetido ou intenção diferente aceita sob a mesma chave |
| Information Disclosure | erro/provider expõe IDs, payload ou dados internos | enumeração, vazamento de PII, secret ou estado financeiro interno |
| Spoofing | guest apresenta capability ausente, inválida, expirada ou de outro carrinho | acesso ou mutação de recurso alheio |
| Bypass | operação nativa cria estado financeiro fora do fluxo aprovado | cobrança, confirmação ou `Order` fora do caminho canônico |

O RESEARCH deve considerar também bypass por método alternativo, alias de rota,
expansão de campos, middleware não aplicado, diferença entre `/auth` e `/store`,
e comportamento herdado do framework. A enumeração completa pertence ao
RESEARCH, não a este CONTEXT.

## 3. Scope

### In scope

- `FND-01..FND-08`;
- política da superfície Store;
- boundary BFF → Medusa;
- princípios do contrato público de erros;
- primitivo lógico de idempotência;
- distinção entre idempotência, locking e constraints;
- primitivo lógico de optimistic concurrency;
- fundação do Store OpenAPI `1.1.0`;
- threat model e perguntas para RESEARCH.

### Explicitly out of scope

- Phase 14: auth, verificação, reset e refresh;
- Phase 15: guest capability, mutações completas e versionamento de Cart;
- Phase 16: merge e review;
- Phase 17: checkout BR, CPF e consentimentos;
- Phase 18: quote/select de frete;
- Phase 19: hardening de `PaymentAttempt`;
- Phase 20: confirmação assíncrona;
- Phase 21: resumo de Order, resolução de catálogo e revalidação;
- Phase 22: types, Zod, fixtures, mocks, gates e release;
- frontend, BFF ou projeto Next.js;
- provider real, deploy, migration, package/dependency ou runtime change.

Esses domínios podem aparecer somente como consumidores futuros dos primitivos
transversais definidos aqui.

## 4. Requirements Covered

Nenhum requisito está completo neste gate. O CONTEXT cobre as decisões que o
RESEARCH futuro deverá respeitar.

| ID | Context locked for future work | Completion now |
|---|---|---|
| `FND-01` | inventariar a superfície Store da versão instalada e classificar cada operação relevante como `AUTHORIZED`, `EXTENDED`, `BLOCKED` ou `OUTSIDE_FRONTEND_M1` | open |
| `FND-02` | adotar allowlist fail-closed e provar ausência de bypass, especialmente de criação de `Order` | open |
| `FND-03` | padronizar princípios de `StoreErrorResponse`, códigos, autorização não enumerável e correlation ID sanitizado | open |
| `FND-04` | definir registro lógico de idempotência escopado, com fingerprint, replay seguro e retenção finita | open |
| `FND-05` | rejeitar key reutilizada com intenção incompatível e não confundir idempotência com locks/constraints | open |
| `FND-06` | definir versão monotônica server-authoritative, `ETag`/`If-Match` e `412` para stale mutation | open |
| `FND-07` | fixar o BFF same-origin como único consumidor storefront autorizado | open |
| `FND-08` | preparar Store OpenAPI `1.1.0` a partir do registry TypeScript, sem antecipar operações futuras | open |

## 5. Inherited Invariants from v1.0

As regras abaixo são imutáveis nesta phase:

1. `Order` somente após webhook Stripe canônico confiável.
2. Nenhuma rota Store cria `Order`.
3. `purchase_completed` continua backend-only e durável.
4. Gelato depende de `Order` confirmado e do evento local exigido pelo pipeline existente.
5. Falhas externas não alteram verdade financeira.
6. Estados negativos de Pix não criam `Order`.
7. Refund truth continua dependente do webhook Stripe confiável.
8. Secrets e tokens opacos não entram em logs.
9. CPF cru não entra em logs ou telemetry.
10. `client_secret` não é persistido em armazenamento durável indevido.
11. O fluxo financeiro fechado no v1.0 não será reescrito sem necessidade concreta e comprovada.
12. Tag, Release e arquivo histórico `v1.0` permanecem imutáveis.

## 6. Current As-Built Facts Relevant to Decisions

Estes fatos são contexto local, não o inventário final de `FND-01`:

- o workspace fixa `@medusajs/cli`, `@medusajs/framework` e
  `@medusajs/medusa` em `2.16.0`;
- o registry TypeScript em `apps/backend/src/api-docs/` é a autoridade dos
  contratos e gera três JSONs determinísticos;
- o Store OpenAPI as-built ainda declara `1.0.0-draft.1`; `1.1.0` é target;
- o contrato Store atual documenta dez operações as-built, incluindo health,
  catálogo, active cart, attach, card, Pix e tracking;
- a iniciativa API-DOCS-01 identificou nove operações Store na evidência
  inicial (sete exports locais e duas extensões nativas), mas não inventariou
  toda a superfície nativa instalada;
- `GET /store/products` e `GET /store/products/{id}` são extensões nativas por
  middleware com serializer/field set público fechado;
- handlers Store customizados existem para active cart, attach, card, Pix e
  tracking; `/store/custom` é scaffold excluído do contrato inicial;
- o middleware atual é composto por matchers específicos; não existe hoje uma
  política global de allowlist fail-closed para toda a superfície Store;
- as rotas de card/Pix derivam dinheiro no servidor, rejeitam money fields do
  caller e não criam `Order` sincronamente;
- `PaymentAttempt` persiste trilha operacional e valores em BRL minor units;
  material sensível de Stripe permanece response-only nos limites já aceitos;
- `CheckoutCompletionLog` já protege a criação de `Order` por idempotência
  canônica ligada a `payment_intent_id`, mas isso não é um primitivo transversal
  genérico para todas as operações Store;
- não foi encontrado, no allowlist inspecionado, primitivo transversal já
  materializado de `Idempotency-Key`, versão monotônica de Cart ou
  `ETag`/`If-Match` para todas as mutações futuras;
- Store/Admin/Webhooks OpenAPI e Swagger UI permanecem desabilitados por padrão
  em produção; Swagger continua globalmente não interativo.

<decisions>
## 7. Binding Decisions (`D13-*`)

### Boundary and surface policy

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

### Error contract

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

### Idempotency

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

### Optimistic concurrency

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

### OpenAPI foundation

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

### Governance

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

### Agent discretion

Nenhuma discricionariedade para relaxar boundary, fail-closed, invariantes de
`Order`, error minimization, idempotência, concorrência, target `1.1.0`, escopo
ou progressão de gate. O RESEARCH futuro poderá comparar técnicas apenas dentro
dessas decisões e mediante autorização explícita.

</decisions>

## 8. Explicit Prohibitions

Este gate não autoriza:

- `13-RESEARCH.md`, PLAN, SPEC/SDD ou implementation prompt;
- código runtime, middleware, rota, serializer, validator ou model;
- migration, banco, Redis, Docker, teste de runtime ou build;
- pacote, dependency, manifest ou lockfile;
- geração/edição de OpenAPI;
- env/config real, Heroku, Stripe, Gelato, Resend, PostHog ou Sentry externo;
- deploy, rollback, push, PR, merge ou frontend;
- Phase 14 ou qualquer gate posterior.

## 9. Dependencies

- Milestone v1.0 fechado, arquivado, tagueado e publicado.
- API-DOCS-01 fechada, com registry e gates existentes preservados.
- Phase 13 deve fechar antes da Phase 14.
- Phases 14–21 dependem dos primitivos transversais e da política de superfície.
- Phase 22 materializa o kit final e os gates de release/handoff.
- Frontend Milestone 1 permanece bloqueado até Phase 22 e closeout humano de
  v1.1.

<canonical_refs>
## 10. Canonical References

**Future RESEARCH and planning agents MUST read these sources.**

### GSD authority and milestone state

- `.planning/PROJECT.md` — Core Value, active milestone, v1.0 inheritance and frontend block.
- `.planning/STATE.md` — current manual gate and progress counters.
- `.planning/ROADMAP.md` — Phase 13 goal, dependencies, deliverables and exit criteria.
- `.planning/REQUIREMENTS.md` — authoritative `FND-01..FND-08` statements.
- `.planning/MILESTONES.md` — v1.1 opening and final authorization boundary.
- `.planning/config.json` — interactive mode, no auto-advance and phase branching strategy.
- `.planning/milestones/v1.1-ROADMAP.md` — immutable opening sequence `13 → 22`.
- `.planning/milestones/v1.1-REQUIREMENTS.md` — 91 open requirements and 0 complete.

### Product and contract authority

- `docs/PRD_Backend_v1.1.md` — target Store contract, BFF boundary, errors, idempotency and concurrency.
- `docs/PRD_frontend_v1.1.md` — future BFF consumer behavior and no direct browser access.
- `docs/SRS_v1.5.md` — normative requirements and authority order.
- `docs/DB_MODEL_v1.21.md` — current data invariants; does not yet choose the new transversal physical models.
- `docs/FRONTEND_CONTRACT_TRACEABILITY.md` — FE mapping and artifact-pending distinction.

### Existing API docs and route evidence

- `.planning/initiatives/api-docs-openapi-swagger/CLOSURE.md` — API-DOCS-01 closed contract and operational boundaries.
- `.planning/initiatives/api-docs-openapi-swagger/ROUTE-INVENTORY.md` — initial as-built route evidence; explicitly not a complete native Store inventory.
- `apps/backend/src/api/middlewares.ts` — current local matcher/guard extensions.
- `apps/backend/src/api/store/` — current project-owned Store routes and serializers.
- `apps/backend/src/api-docs/` — registry, Store schemas/operations and deterministic generation source.
- `apps/backend/src/modules/checkout/` — current active-cart, attach and checkout-data behavior.
- `apps/backend/src/modules/payment-attempt/` — current pre-Order payment boundary and state.
- `apps/backend/src/modules/checkout-completion/` — current webhook-driven Order idempotency boundary.
- `apps/backend/src/config/env.ts` — current CORS/API docs/runtime env contracts.
- `apps/backend/medusa-config.ts` — current module/provider registration.

</canonical_refs>

<code_context>
## 11. Existing Code Insights

### Reusable assets

- API Docs registry/generator/coverage gates provide the established source-of-truth and drift pattern.
- Store catalog serializers already demonstrate allowlist-first public DTOs and native extension by middleware.
- Store cart serializer already exposes a reduced pre-Order DTO and masks federal tax data.
- PaymentAttempt safe boundary already separates Cart/PaymentSession major units from provider/custom minor units.
- CheckoutCompletionLog already demonstrates unique idempotency plus terminal-result reuse for the Order birth path.
- Correlation/access-log middleware already provides a sanitized correlation foundation to evaluate.

### Established patterns

- local routes use explicit request validation, ownership checks and allowlisted serializers;
- provider material is sanitized and sensitive values are response-only where accepted;
- modules preserve pre-Order state and the webhook remains the only Order birth trigger;
- OpenAPI examples and schemas are guarded against sensitive fields;
- production docs remain disabled by default and Swagger is non-interactive.

### Integration points for future gates

- global Store surface policy: router/middleware boundary plus installed route evidence;
- error primitive: Store routes, Medusa errors and API Docs component registry;
- idempotency primitive: future cross-operation persistence boundary, without reusing CheckoutCompletionLog generically;
- concurrency primitive: Cart mutations/serializers and future ETag/If-Match contract;
- OpenAPI `1.1.0`: existing TypeScript registry and read-only drift gate.

</code_context>

<specifics>
## 12. Open Questions for RESEARCH

Estas perguntas não foram resolvidas neste gate:

1. Qual é a lista completa de rotas Store nativas efetivamente instaladas no Medusa `2.16.0`?
2. Qual técnica factual bloqueia ou estende cada rota sem deixar aliases, métodos ou caminhos alternativos?
3. Quais rotas nativas podem ser reutilizadas preservando integralmente as decisões `D13-*`?
4. Qual mecanismo físico garante CartVersion monotônica, atômica e sem lost update?
5. Qual schema físico representa o idempotency store transversal?
6. Qual TTL/retenção por operação é necessário e canônico?
7. Quais controles pertencem a PostgreSQL e quais, se algum, pertencem a Redis?
8. Qual estratégia de locking/constraint complementa idempotência e optimistic concurrency?
9. Quais hooks/primitives do Medusa `2.16.0` são adequados e quais criam bypass?
10. Será necessária migration; em quais módulos e com quais constraints?
11. Como compatibilizar erros nativos com o envelope público sem vazar detalhes ou quebrar semântica?
12. Quais schemas/headers/security schemes exatos entram na fundação OpenAPI da Phase 13?
13. Como o coverage gate deve representar `AUTHORIZED`, `EXTENDED`, `BLOCKED` e `OUTSIDE_FRONTEND_M1`?
14. Qual prova negativa demonstra que nenhuma operação Store cria `Order` ou equivalente?
15. Há impacto adicional específico do Medusa `2.16.0` nos endpoints de auth/store que deve ser levado às Phases 14–21?
16. Alguma alteração de package/dependency é necessária? Ausência de prova mantém a resposta aberta, não presumida.

</specifics>

## 13. Success Criteria for the Future Phase

A Phase 13 futura somente poderá reivindicar conclusão quando evidência aprovada
demonstrar, no mínimo:

1. inventário completo da superfície Store da versão instalada;
2. classificação explícita de cada operação relevante;
3. allowlist fail-closed aplicada e testada;
4. native-route bypass negativo aprovado;
5. nenhum caminho Store/BFF cria `Order`;
6. `StoreErrorResponse` e catálogo de códigos estáveis materializados;
7. idempotência transversal com replay/conflito e concorrência testados;
8. versão monotônica/ETag/If-Match sem lost update;
9. boundary BFF e security schemes explícitos;
10. fundação Store OpenAPI `1.1.0` gerada pelo registry, sem drift;
11. money schemas declaram BRL e unidade;
12. logs/telemetry permanecem livres de tokens, secrets e CPF cru.

Nenhum item acima é declarado PASS por este CONTEXT.

<deferred>
## 14. Deferred Ideas

- implementação de auth, capability, merge, checkout, shipping, payment,
  confirmation, order summary e catalog revalidation permanece nas Phases
  14–21;
- types, Zod, fixtures, mocks, full contract tests e release/handoff pertencem
  à Phase 22;
- frontend/Next.js permanece fora do milestone backend.

</deferred>

## 15. Manual Review Gate and Handoff

```text
Phase 13 CONTEXT: COMPLETE / AWAITING HUMAN REVIEW
Phase 13 RESEARCH: NOT STARTED / NOT AUTHORIZED
Phase 13 PLAN: NOT STARTED / NOT AUTHORIZED
Implementation: NOT AUTHORIZED
Deploy: NOT AUTHORIZED
Frontend Milestone 1: BLOCKED
Requirements complete: 0/91
Completed phases: 0/10
```

O handoff permitido é somente revisão humana deste `13-CONTEXT.md`. O RESEARCH
futuro deve usar as decisões e perguntas acima, mas só pode iniciar mediante
nova autorização humana explícita.

---

*Phase: 13-storefront-contract-foundation-surface-lockdown*
*Context gathered: 2026-08-07*
