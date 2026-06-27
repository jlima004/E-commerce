# Phase 03: Cart & Checkout (pre-Order) - Research

**Researched:** 2026-06-27
**Domain:** Medusa v2 Store API cart/checkout pre-Order, Brasil/BRL, guest e customer autenticado
**Confidence:** HIGH para escopo/produto/padroes locais; MEDIUM para detalhes finos de extensao Medusa confirmados via Context7 do orquestrador e consulta Context7 desta sessao.

## User Constraints (from 03-CONTEXT.md)

### Locked Decisions

#### Ownership e ciclo de vida do cart
- **D-01:** Ha **um unico cart ativo por ator** no MVP. Guest tem um cart ativo; customer autenticado tem um cart ativo. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-02:** No login, o **guest cart da sessao atual vence** no MVP quando estiver preenchido e nao vazio: ele e anexado ao customer e passa a ser o unico cart ativo do customer. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-03:** O cart ativo anterior do customer, quando substituido pelo guest cart da sessao atual, **deixa de ser ativo mas nao e deletado**. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-04:** Se **nao houver guest cart** na sessao, o cart ativo existente do customer continua como fonte de verdade. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-05:** Se o **guest cart estiver vazio**, o backend **preserva o cart ativo existente do customer** para nao sobrescrever um cart util com um cart vazio. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-06:** Nesta fase **nao existe merge complexo de linhas** entre guest cart e customer cart, nem resolucao explicita de conflitos. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-07:** O cart permanece **livremente editavel** em estado pre-Order: itens, quantidades, email e shipping address podem mudar sem travamento permanente. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]

#### Identidade e email de contato
- **D-08:** Para customer autenticado, `customer.email` e a **fonte de verdade** do checkout no MVP e **nao pode ser sobrescrito** no cart. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-09:** Se um guest cart ja tiver email e depois for anexado a um customer autenticado, o email de contato do cart e **normalizado para `customer.email`**. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-10:** Para guest, o email informado no checkout continua sendo a fonte de contato enquanto nao houver autenticacao. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-11:** Guest pode **criar, montar e editar** cart sem email; email valido so se torna obrigatorio quando o backend precisar considerar o checkout **com dados completos**. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-12:** Email ausente ou invalido **nao bloqueia o uso basico do cart**; bloqueia apenas a condicao derivada de checkout completo. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]

#### Contrato minimo do shipping address Brasil/Gelato
- **D-13:** Para `checkout_data_complete = true`, o endereco precisa conter: `full_name`, `address_1`, `city`, `province`/`state`, `postal_code`, `country_code = BR` e `federal_tax_id` do destinatario (aceitando CPF ou CNPJ). [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-14:** `phone`, `address_2`/`complement`, `company` e `state_tax_id` permanecem **opcionais** nesta fase. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-15:** `country_code` deve ser sempre **`BR`** no MVP. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-16:** `postal_code` aceita CEP com ou sem mascara e e **normalizado para 8 digitos**. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-17:** `federal_tax_id` aceita CPF ou CNPJ, e **normalizado para digitos** e precisa passar validacao estrutural, incluindo tamanho e digitos verificadores. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-18:** `province`/`state` deve ser normalizado preferencialmente para **UF brasileira**. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-19:** `full_name`, `address_1` e `city` sao obrigatorios e nao vazios. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]

#### Nivel de validacao do endereco
- **D-20:** A Phase 03 aplica **apenas validacao estrutural e normalizacao** do endereco; nao faz validacao externa/postal profunda. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-21:** `phone`, se informado, pode ser normalizado/validado em formato basico, mas **nao bloqueia** `checkout_data_complete`. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-22:** Ficam explicitamente fora do escopo desta fase: validacao externa de CEP, consulta a Correios/ViaCEP, consistencia CEP-cidade-UF, geocoding e validacao real de entregabilidade. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]

#### Limite do checkout sem Order
- **D-23:** A Phase 03 **nao persiste nenhum novo status nominal** no cart para representar prontidao. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-24:** Podemos usar **`checkout_data_complete` apenas como linguagem de negocio/documentacao ou campo calculado de resposta**, nunca como status persistido definitivo. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-25:** O nome **`ready_for_payment` nao deve existir nesta fase**, para nao antecipar semantica da Phase 04. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-26:** `checkout_data_complete = true` somente quando o cart tiver: itens validos, email valido, shipping address valido conforme este contrato, `country_code = BR`, e regiao/moeda compativeis com Brasil/BRL. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-27:** Qualquer alteracao em itens, quantidade, email ou shipping address **recalcula** a condicao derivada. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-28:** `checkout_data_complete = true` **nao** cria `Order`, **nao** cria `PaymentAttempt`, **nao** inicia Stripe/Pix, **nao** dispara webhook e **nao** aciona fulfillment. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]

#### Itens validos para `checkout_data_complete`
- **D-29:** O cart precisa ter **pelo menos um line item**. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-30:** Cada item precisa ter **quantidade positiva**. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-31:** O item precisa referenciar uma variante **vendavel/publicavel** conforme a fronteira publica de catalogo construida na Phase 02. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-32:** O cart precisa estar associado ao contexto **Brasil/BRL**. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- **D-33:** A Phase 03 **reaproveita** a fronteira de vendabilidade da Phase 02 e **nao duplica** a validacao catalogal/Gelato profunda dentro do checkout. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]

### the agent's Discretion
- Nomes concretos de rotas, handlers, DTOs, middlewares e utilitarios podem ser definidos na pesquisa/plano, desde que preservem integralmente os contratos acima. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- O formato exato de resposta para expor `checkout_data_complete` pode ser decidido depois, desde que permaneca **derivado**, recalculavel e nao persistido como status. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- O mecanismo tecnico para marcar um cart antigo como "nao ativo" pode variar no plano, desde que nao introduza multiplos carts ativos simultaneos para o mesmo ator dentro das regras acima. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]

### Deferred Ideas (OUT OF SCOPE)
- Merge avancado de carts (mescla de linhas, resolucao explicita de conflito, multiplos carts por customer) - fase futura se houver necessidade real. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- Telefone obrigatorio, validacao postal externa e checks fortes de entregabilidade - fase futura de hardening/logistica, nao nesta Phase 03. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- Qualquer semantica persistida de "ready for payment" - avaliar apenas se uma fase futura realmente precisar disso. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- Revalidacao profunda de snapshot/fulfillment no checkout - permanece reservada para as fases de `Order` e Gelato. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]

## Objetivo e Escopo da Pesquisa

Esta pesquisa existe para permitir o planejamento da Phase 03 sem transformar a fase em implementacao: o planner deve saber como modelar cart guest, cart autenticado, attach no login, email de checkout, endereco brasileiro com `federal_tax_id` e `checkout_data_complete` derivado, mantendo o sistema estritamente pre-Order. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]

O escopo tecnico recomendado e estender os fluxos core de cart da Store API Medusa com validacao/normalizacao e shaping de resposta, reaproveitando os padroes locais de middleware, serializer, helpers tipados e testes Jest ja usados em Phase 02. [VERIFIED: apps/backend/src/api/middlewares.ts] [VERIFIED: apps/backend/src/api/store/products/serializers.ts] [VERIFIED: apps/backend/jest.config.js]

Pesquisa desbloqueia planejamento, mas o workflow deve parar no gate manual agora: nao criar `PLAN.md`, nao implementar codigo, nao rodar migrations, nao fazer deploy e nao alterar secrets/config vars. [VERIFIED: .planning/STATE.md] [VERIFIED: AGENTS.md]

## Project Constraints (from AGENTS.md)

- Responder em Portugues do Brasil. [VERIFIED: AGENTS.md]
- Antes de usar ferramentas de escrita, iniciar trabalho por um comando/fluxo GSD; esta tarefa foi explicitamente aberta como research-only da Phase 03 e limita a escrita ao `03-RESEARCH.md`. [VERIFIED: AGENTS.md] [VERIFIED: .planning/STATE.md]
- Stack obrigatoria: Medusa v2 + Node.js + TypeScript, persistencia PostgreSQL/Supabase + Redis, Brasil/BRL single-currency, backend-only MVP. [VERIFIED: AGENTS.md]
- Order nunca deve ser criado antes do webhook Stripe confiavel; fulfillment Gelato nunca deve ocorrer antes de Order confirmado e regras posteriores. [VERIFIED: AGENTS.md] [VERIFIED: .planning/research/ARCHITECTURE.md]
- Secrets, dados completos de cartao, tokens puros, payloads sensiveis, cookies, authorization headers e PII desnecessaria nao podem aparecer em logs/Sentry. [VERIFIED: AGENTS.md] [VERIFIED: .planning/phases/01-foundation-observability/01-CONTEXT.md]
- Contratos de API devem antecipar a storefront futura, sem introduzir storefront/framework frontend neste repositorio. [VERIFIED: AGENTS.md] [VERIFIED: .planning/PROJECT.md]

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CART-01 | A guest can create and manage a cart without an account. | Usar Store API core `/store/carts` e linhas de cart, sem exigir email para uso basico; manter um cart ativo por guest/session. [VERIFIED: .planning/REQUIREMENTS.md] [CITED: Context7 /medusajs/medusa POST /store/carts] |
| CART-02 | An authenticated customer can create and manage a cart associated with their account. | Usar customer autenticado como fonte de verdade de email e associar cart via fluxo autenticado, com `transferCart(cartId)` para guest cart da sessao atual quando aplicavel. [VERIFIED: .planning/REQUIREMENTS.md] [CITED: Context7 /medusajs/medusa transferCart] |
| CART-03 | Checkout collects and validates customer email and shipping address suitable for Gelato/Correios. | Implementar validacao estrutural/normalizacao local para email, CEP, CPF/CNPJ, `country_code=BR`, UF e campos obrigatorios, sem ViaCEP/Correios/geocoding. [VERIFIED: .planning/REQUIREMENTS.md] [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md] |
| CART-04 | Checkout creates no Order; cart remains pre-Order until payment is confirmed. | Bloquear uso de `/store/carts/:id/complete` e `completeCartWorkflow` nesta fase; provar negativamente ausencia de Order, PaymentAttempt, PaymentSession, webhook e Gelato. [VERIFIED: .planning/REQUIREMENTS.md] [CITED: Context7 /medusajs/medusa POST /store/carts/:id/complete] |

## Padroes Tecnicos Medusa v2 Relevantes

| Tema | Achado | Implicacao para planejamento |
|------|--------|------------------------------|
| Criacao de cart | `POST /store/carts` cria cart para acompanhar itens, endereco e detalhes de checkout; pode receber `region_id` e itens iniciais. [CITED: Context7 /medusajs/medusa POST /store/carts] | Planejar sobre Store API core, nao rota custom grande para criar cart. |
| Atualizacao de cart | `POST /store/carts/{cartId}` atualiza cart e recalcula totais. [CITED: Context7 /medusajs/medusa POST /store/carts/{cartId}] | Email/endereco podem ser normalizados antes/depois da mutacao e resposta deve recalcular `checkout_data_complete`. |
| Attach no login | `transferCart(cartId)` associa cart ao customer autenticado e requer request autenticada; e indicado quando guest loga. [CITED: Context7 /medusajs/medusa transferCart] | Usar `transferCart` como primitiva padrao para D-02, mas adicionar regra local de guest vazio nao sobrescrever customer cart. |
| Completion default | `sdk.store.cart.complete` e `POST /store/carts/:id/complete` completam cart e criam Order. [CITED: Context7 /medusajs/medusa Complete Cart] | Tratar completion default como anti-pattern nesta fase; nenhum plano deve chamar esse endpoint/workflow. |
| Validacao de body | `defineMiddlewares` com `validateAndTransformBody` aplica schema Zod em rotas custom. [CITED: docs.medusajs.com/resources/integrations/guides/algolia via Context7] | Para endpoints custom pequenos de checkout/attach, usar schema Zod no middleware em vez de parse manual espalhado. |
| Extensao de cart | `additionalDataValidator` em `/store/carts` valida campos custom em `additional_data` com Zod. [CITED: docs.medusajs.com/resources/commerce-modules/cart/extend via Context7] | Se o planner optar por `additional_data` para `federal_tax_id`/campos auxiliares, validar na borda e manter sem status persistido. |
| Validacao de itens | Hooks como `addToCartWorkflow.hooks.validate` podem consultar `query.graph` para validar variantes. [CITED: Context7 informado pelo orquestrador] | Reaproveitar `isSellableVariant`/query graph da Phase 02 para itens validos, sem duplicar validacao Gelato profunda. |

### Fronteiras Negativas Obrigatorias

- Nao chamar `/store/carts/:id/complete`, `sdk.store.cart.complete` ou `completeCartWorkflow` durante a Phase 03, porque o fluxo Medusa cria Order. [CITED: Context7 /medusajs/medusa POST /store/carts/:id/complete]
- Nao criar `PaymentAttempt`; o modelo global registra `PaymentAttempt` como camada pre-Order de tentativas de pagamento, mas Phase 03 bloqueia pagamentos e esse modelo pertence a Phase 04. [VERIFIED: .planning/PROJECT.md] [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- Nao criar `PaymentCollection`/`PaymentSession`, apesar de serem parte do estado pre-pagamento global, porque a restricao absoluta desta pesquisa exclui iniciar Stripe/Pix ou PaymentSession. [VERIFIED: .planning/PROJECT.md] [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- Nao criar webhook Stripe/Gelato nem tocar em raw-body/webhook routing. [VERIFIED: .planning/phases/01-foundation-observability/01-CONTEXT.md] [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- Nao chamar Gelato, nao montar fulfillment e nao persistir snapshot em `LineItem`; a Phase 02 entregou apenas helper puro para consumo futuro na Phase 6. [VERIFIED: .planning/phases/02-catalog-media/02-CONTEXT.md] [VERIFIED: docs/DB_MODEL_v1.21.md]

## Padroes Locais do Codigo/Repo

| Arquivo | Padrao observado | Como o planner deve reutilizar |
|---------|------------------|--------------------------------|
| `apps/backend/src/api/middlewares.ts` | Centraliza `defineMiddlewares`, correlation ID, access log, Sentry error handler e middlewares Store/Admin. [VERIFIED: apps/backend/src/api/middlewares.ts] | Adicionar wiring de checkout/cart aqui, preservando logging allowlist e sem logar body/query sensivel. |
| `apps/backend/src/api/store/products/query-config.ts` | Forca field selection publico e deduplica campos para Store API. [VERIFIED: apps/backend/src/api/store/products/query-config.ts] | Criar query config/fields minimos para cart se a resposta precisar de campos extras; evitar payload amplo e vazamento interno. |
| `apps/backend/src/api/store/products/serializers.ts` | Intercepta `res.json`, serializa shape shopper-facing, filtra variantes nao vendaveis e remove `gelato_*`. [VERIFIED: apps/backend/src/api/store/products/serializers.ts] | Expor `checkout_data_complete` por serializer/response shaping derivado, nao por coluna/status persistido. |
| `apps/backend/src/api/admin/products/validators.ts` | Mapeia erros tipados para mensagens operacionais seguras e testa canarios de segredo/stack. [VERIFIED: apps/backend/src/api/admin/products/validators.ts] | Para checkout/address, criar erros tipados e mensagens sem CPF/CNPJ completo, sem stack e sem detalhes internos. |
| `apps/backend/src/workflows/catalog/validate-sellable-variant.ts` | Exporta `isSellableVariant` e valida publicacao usando helper central. [VERIFIED: apps/backend/src/workflows/catalog/validate-sellable-variant.ts] | Usar essa fronteira para determinar line item vendavel/publicavel; nao acessar `variant.metadata.gelato_*` diretamente. |
| `apps/backend/src/modules/catalog/gelato-metadata.ts` | Helper central decide metadata completa e preco BRL em centavos inteiros. [VERIFIED: apps/backend/src/modules/catalog/gelato-metadata.ts] | O checkout deve perguntar "a variante e vendavel?" por helper/fonte central, sem recriar validacao catalogal. |
| `apps/backend/medusa-config.ts` | Config Medusa usa env tipado, logger, worker mode, Redis modules e storage modules. [VERIFIED: apps/backend/medusa-config.ts] | Phase 03 nao deve alterar config vars/secrets; qualquer necessidade de config e gate manual, mas nenhuma foi identificada. |
| `apps/backend/jest.config.js` e `apps/backend/package.json` | Jest 29.7, `@medusajs/test-utils` 2.16.0, scripts `test:unit` e `test:integration:http`. [VERIFIED: apps/backend/jest.config.js] [VERIFIED: apps/backend/package.json] | Planejar unit tests para normalizadores/calculadores e HTTP integration tests para Store API cart/checkout. |
| `apps/backend/integration-tests/http/catalog-store.spec.ts` | Testa handlers Medusa core importados de `node_modules` com mocks de `query.graph` e middleware local. [VERIFIED: apps/backend/integration-tests/http/catalog-store.spec.ts] | Repetir este estilo para cart: testar core route + middleware/serializer local quando possivel, sem banco/migration. |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Guest cart ativo | API / Backend | Database / Storage | A API decide identidade de sessao e cart ativo; persistencia fica no cart core ou metadado controlado, sem logica no browser. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md] |
| Customer cart ativo | API / Backend | Database / Storage | Customer autenticado e attach exigem request autenticada e associacao server-side. [CITED: Context7 /medusajs/medusa transferCart] |
| Email de checkout | API / Backend | Database / Storage | Backend normaliza fonte guest vs `customer.email` e calcula completude. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md] |
| Shipping address Brasil/Gelato | API / Backend | Database / Storage | Validacao estrutural/normalizacao pertence ao backend; storage guarda o endereco no cart, sem consulta externa. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md] |
| `checkout_data_complete` | API / Backend | Browser / Client | Campo e derivado na resposta; cliente apenas consome, nao e fonte de verdade. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md] |
| Provas negativas de Order/pagamento/Gelato | API / Backend | Database / Storage | Testes devem confirmar que nenhuma entidade/endpoint/fase posterior foi acionada. [VERIFIED: .planning/REQUIREMENTS.md] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@medusajs/medusa` / `@medusajs/framework` | 2.16.0 instalado | Store API, cart core, middleware HTTP, workflows/hooks. | Stack obrigatoria e ja instalada; manter minor/patch alinhado ao repo. [VERIFIED: apps/backend/package.json] |
| TypeScript | 5.6.2 instalado | Tipos de DTOs, helpers e contratos de resposta. | Padrao existente do app Medusa. [VERIFIED: apps/backend/package.json] |
| Zod via `@medusajs/framework/zod` ou pacote instalado | `zod` 4.2.0 instalado | Validacao de request bodies e normalizadores estruturais. | Medusa docs usam Zod em `validateAndTransformBody`/`additionalDataValidator`; repo ja tem Zod. [VERIFIED: apps/backend/package.json] [CITED: docs.medusajs.com/resources/commerce-modules/cart/extend] |
| Jest + `@medusajs/test-utils` | Jest 29.7.0, test-utils 2.16.0 | Unit e HTTP integration tests. | Padrao de Phase 02 ja validado. [VERIFIED: apps/backend/package.json] [VERIFIED: .planning/phases/02-catalog-media/02-VALIDATION.md] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Nenhum pacote novo | n/a | Phase 03 deve usar core Medusa e helpers locais. | Evita supply-chain desnecessaria e preserva research-only sem install. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md] |

**Installation:** nenhuma instalacao recomendada nesta fase. [VERIFIED: apps/backend/package.json]

## Package Legitimacy Audit

Nenhum pacote externo novo e recomendado para Phase 03; nao ha `npm install` planejado pela pesquisa. [VERIFIED: apps/backend/package.json]

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| n/a | n/a | n/a | n/a | n/a | n/a | Nenhuma dependencia nova. |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

## Recomendacoes de Decomposicao para Planos Pequenos

Isto nao e um plano executavel; e uma decomposicao recomendada para o futuro planner. [VERIFIED: tarefa do usuario]

| Slice recomendada | Objetivo | Gate manual recomendado |
|-------------------|----------|-------------------------|
| 03-01 Cart ativo guest/customer | Definir contrato de cart ativo, recuperacao e associacao basica sem PaymentSession. | Revisar se a solucao tecnica para "cart antigo nao ativo" exige persistencia nova/migration; se exigir, parar, pois migrations estao proibidas nesta fase. |
| 03-02 Attach guest no login | Implementar regra D-02..D-06 com `transferCart(cartId)` quando guest cart atual e nao vazio. | Confirmar UX/contrato de sessao para identificar o "guest cart da sessao atual"; se nao houver identificador confiavel, gate manual antes do plano. |
| 03-03 Email e address normalizers | Criar helpers puros para email, CEP, CPF/CNPJ, UF, `country_code=BR` e campos obrigatorios. | Confirmar se CPF/CNPJ completo pode ficar em cart address/metadata ou se deve haver politica de mascaramento/criptografia ja nesta fase. |
| 03-04 `checkout_data_complete` derivado | Calcular completude por helper/serializer a cada resposta de cart relevante. | Verificar que nao existe persistencia de status e que `ready_for_payment` nao aparece em codigo/testes/docs da fase. |
| 03-05 Provas negativas e contratos HTTP | Testar guest/auth cart, validacao, resposta derivada e ausencia de Order/PaymentAttempt/PaymentSession/webhook/Gelato. | Manter plano encerrado em manual review; nao executar migrations/deploy nem smoke mutativo em producao. |

### Recomendacao Primaria

Use uma camada fina de helpers puros + middlewares/serializers de Store API, com testes unitarios dos normalizadores e integration tests HTTP simulando rotas Medusa, mantendo todo estado de prontidao como resposta derivada. [VERIFIED: apps/backend/src/api/store/products/serializers.ts] [VERIFIED: apps/backend/integration-tests/http/catalog-store.spec.ts]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cart core CRUD | Um modulo custom de carrinho paralelo ao Medusa. | Store API/core Cart Medusa. | Evita duplicar totais, linhas e convencoes de cart. [CITED: Context7 /medusajs/medusa POST /store/carts] |
| Attach de guest cart | Merge manual complexo de linhas. | `transferCart(cartId)` + regras locais D-02..D-06. | Docs Medusa ja oferecem associacao autenticada; contexto proibe merge complexo. [CITED: Context7 /medusajs/medusa transferCart] [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md] |
| Validacao profunda de endereco | Cliente Correios/ViaCEP/geocoding. | Validacao estrutural local de BR/CEP/CPF/CNPJ/UF. | Phase 03 exclui validacao externa/postal profunda. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md] |
| Prontidao persistida | Coluna/status `ready_for_payment` ou `checkout_data_complete` persistido. | Helper calculado na resposta. | Contexto proibe status persistido e o nome `ready_for_payment`. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md] |
| Completion de checkout | `completeCartWorkflow` ou `/store/carts/:id/complete`. | Apenas coletar dados e manter cart pre-Order. | Complete cart cria Order nos docs Medusa. [CITED: Context7 /medusajs/medusa POST /store/carts/:id/complete] |
| Validade catalogal profunda | Reinterpretar metadata Gelato no checkout. | `isSellableVariant` e fronteira publica da Phase 02. | Phase 02 ja centralizou a vendabilidade; Phase 03 deve reaproveitar. [VERIFIED: apps/backend/src/workflows/catalog/validate-sellable-variant.ts] |

## Common Pitfalls

### Pitfall 1: Chamar o completion padrao do Medusa
**What goes wrong:** `/store/carts/:id/complete` cria Order e viola CART-04. [CITED: Context7 /medusajs/medusa POST /store/carts/:id/complete]
**How to avoid:** Testar explicitamente que nenhum handler/fluxo da Phase 03 importa ou chama completion; manter checkout como coleta de dados. [VERIFIED: .planning/research/PITFALLS.md]
**Warning signs:** Resposta com `order`, import de `completeCartWorkflow`, ou teste que espera `order_id`. [CITED: Context7 /medusajs/medusa Complete Cart]

### Pitfall 2: Transformar `checkout_data_complete` em estado persistido
**What goes wrong:** O cart fica com status stale apos mudanca de item/email/endereco. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
**How to avoid:** Calcular em helper puro a partir do cart atual e serializar na resposta. [VERIFIED: apps/backend/src/api/store/products/serializers.ts]
**Warning signs:** Campo em model/migration, nome `ready_for_payment`, ou update dedicado de status. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]

### Pitfall 3: Sobrescrever cart util do customer com guest vazio
**What goes wrong:** Login perde o cart ativo existente do customer. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
**How to avoid:** Antes de `transferCart`, verificar se o guest cart da sessao atual existe e tem line items com quantidade positiva. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
**Warning signs:** Attach roda sempre no login, sem branch para guest cart ausente/vazio. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]

### Pitfall 4: Vazar PII/documentos em logs
**What goes wrong:** CPF/CNPJ, email, endereco completo ou body de checkout entram em logs/Sentry. [VERIFIED: .planning/phases/01-foundation-observability/01-CONTEXT.md]
**How to avoid:** Reusar access log allowlist, nao logar request body/query e criar mensagens de erro seguras. [VERIFIED: apps/backend/src/api/middlewares.ts] [VERIFIED: apps/backend/src/api/admin/products/validators.ts]
**Warning signs:** `request.log.info({ body })`, mensagem de erro com documento completo, stack cru em resposta. [VERIFIED: apps/backend/src/observability/__tests__/logger.unit.spec.ts]

### Pitfall 5: Duplicar validacao catalogal/Gelato no checkout
**What goes wrong:** Checkout diverge da Store API e aceita/rejeita itens de forma diferente. [VERIFIED: .planning/phases/02-catalog-media/02-CONTEXT.md]
**How to avoid:** Usar a mesma fonte `isSellableVariant`/query graph da Phase 02 para itens validos. [VERIFIED: apps/backend/src/workflows/catalog/validate-sellable-variant.ts]
**Warning signs:** Novo parser de `variant.metadata.gelato_*` dentro de cart/checkout. [VERIFIED: .planning/phases/02-catalog-media/02-CONTEXT.md]

## Estrategia de Validacao para Futuros Planos

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 + `@medusajs/test-utils` 2.16.0. [VERIFIED: apps/backend/package.json] |
| Config file | `apps/backend/jest.config.js`. [VERIFIED: apps/backend/jest.config.js] |
| Quick run command | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath <arquivo>`. [VERIFIED: .planning/phases/02-catalog-media/02-VALIDATION.md] |
| HTTP run command | `cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath <arquivo>`. [VERIFIED: .planning/phases/02-catalog-media/02-VALIDATION.md] |
| Build command | `cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build`. [VERIFIED: .planning/phases/02-catalog-media/02-VALIDATION.md] |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| CART-01 | Guest cria/edita cart sem email e sem conta; cart basico continua utilizavel. | integration:http | `cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/cart-checkout-store.spec.ts -t "guest cart"` | Wave 0 gap |
| CART-02 | Customer autenticado mantem um cart ativo; guest cart nao vazio da sessao atual vence no login; guest vazio nao sobrescreve. | integration:http + unit | `cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/cart-checkout-store.spec.ts -t "authenticated|transfer"` | Wave 0 gap |
| CART-03 | Email/endereco BR sao normalizados e validados; CPF/CNPJ/CEP/UF seguem contrato estrutural. | unit + integration:http | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/checkout/__tests__/checkout-data.unit.spec.ts` | Wave 0 gap |
| CART-04 | Checkout data complete nao cria Order/PaymentAttempt/PaymentSession/webhook/Gelato. | integration:http + grep/static negative | `cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/cart-checkout-store.spec.ts -t "pre-Order"` | Wave 0 gap |

### Provas Negativas Obrigatorias

- Grep/static check: nenhum codigo da Phase 03 deve conter `completeCartWorkflow`, `ready_for_payment`, criacao de `PaymentAttempt`, criacao de `PaymentSession`, rota `/hooks`, chamada Stripe/Pix ou chamada Gelato. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- Integration check: apos submissao de email/endereco completo, a resposta pode ter `checkout_data_complete: true`, mas nao pode retornar `order`, `order_id`, `payment_session_id`, `payment_intent_id`, `payment_attempt_id` ou `gelato_order_id`. [VERIFIED: .planning/REQUIREMENTS.md]
- DB/mock check: testes devem provar que servicos/workflows de Order/payment/webhook/fulfillment nao foram resolvidos/chamados. [VERIFIED: .planning/research/PITFALLS.md]
- Repo state check: futuros planos devem registrar que nao rodaram migrations/deploy e nao alteraram secrets/config vars. [VERIFIED: .planning/STATE.md]

### Wave 0 Gaps

- [ ] `apps/backend/src/modules/checkout/__tests__/checkout-data.unit.spec.ts` - normalizacao e calculo derivado.
- [ ] `apps/backend/src/modules/checkout/checkout-data.ts` - helper puro para email/address/completude.
- [ ] `apps/backend/integration-tests/http/cart-checkout-store.spec.ts` - contratos HTTP guest/auth/pre-Order.
- [ ] Possivel `apps/backend/src/api/store/carts/serializers.ts` ou util equivalente - shaping de resposta derivada.

## Security Domain

Security enforcement esta habilitado em `.planning/config.json`; Phase 03 lida com email, endereco e documento fiscal do destinatario, entao privacidade e logs sao parte do planejamento. [VERIFIED: .planning/config.json] [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Usar request autenticada Medusa para customer cart/transfer; nao confiar em customer id vindo do body para sobrescrever email. [CITED: Context7 /medusajs/medusa transferCart] |
| V3 Session Management | yes | Cart guest deve ser amarrado a sessao atual; attach deve usar apenas cart da sessao atual. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md] |
| V4 Access Control | yes | Customer so pode manipular cart associado/autorizado; guest so o cart da sessao. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md] |
| V5 Input Validation | yes | Zod/validators para email, CEP, CPF/CNPJ, UF e `country_code=BR`. [CITED: docs.medusajs.com/resources/commerce-modules/cart/extend] |
| V6 Cryptography | no new crypto | Nao criar tracking tokens nesta fase; nao armazenar tokens puros. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md] |
| V7 Error Handling and Logging | yes | Mensagens saneadas, sem body/query/documento completo em logs. [VERIFIED: .planning/phases/01-foundation-observability/01-CONTEXT.md] |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cart takeover por `customer_id` no body | Elevation of Privilege | Derivar customer da autenticacao, nao aceitar overwrite de email/customer arbitrario. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md] |
| PII em logs/Sentry | Information Disclosure | Access log allowlist e mensagens de erro sem payload bruto. [VERIFIED: apps/backend/src/api/middlewares.ts] |
| Bypass de BR-only | Tampering | Normalizar/rejeitar `country_code` diferente de `BR` e validar UF/CEP estruturalmente. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md] |
| Checkout completo com item nao vendavel | Tampering | Reusar `isSellableVariant`/fronteira publica Phase 02. [VERIFIED: apps/backend/src/workflows/catalog/validate-sellable-variant.ts] |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js/npm | Testes/build futuros | Nao sondado nesta pesquisa; package manager declarado. | npm 10.9.8 em `package.json` | Planner deve executar comandos no ambiente real antes da execucao. [VERIFIED: apps/backend/package.json] |
| Jest | Testes unitarios/HTTP | Declarado no repo. | 29.7.0 | Nenhum necessario. [VERIFIED: apps/backend/package.json] |
| `@medusajs/test-utils` | Integration tests | Declarado no repo. | 2.16.0 | Mock direto de handlers Medusa, como Phase 02, se runner completo for pesado. [VERIFIED: apps/backend/package.json] |
| Network externa | Validacao postal/Stripe/Gelato | Nao requerida. | n/a | Nao usar; fora de escopo. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md] |

**Missing dependencies with no fallback:** none identified for research/planning. [VERIFIED: apps/backend/package.json]

**Missing dependencies with fallback:** external postal validation is intentionally out of scope, not a missing dependency. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]

## Riscos, Perguntas Pendentes e Gates Manuais

### Riscos

- Risco de modelagem: "um cart ativo por ator" pode exigir persistir marcador de ativo/inativo; se a solucao exigir schema novo/migration, o planner deve criar gate manual porque migrations estao proibidas pela tarefa atual e precisam de revisao explicita para a fase de execucao. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- Risco de privacidade: `federal_tax_id` completo e endereco sao PII; o plano deve definir onde ficam armazenados no cart e quais respostas/logs mascaram ou omitem valores. [VERIFIED: .planning/phases/01-foundation-observability/01-CONTEXT.md]
- Risco de boundary: Medusa oferece completion que cria Order; qualquer demo "checkout completo" pode acidentalmente chamar o fluxo proibido. [CITED: Context7 /medusajs/medusa Complete Cart]
- Risco de auth/session: a pesquisa confirma `transferCart`, mas a identificacao concreta do guest cart da sessao atual depende do contrato de sessao/storefront futuro. [CITED: Context7 /medusajs/medusa transferCart] [VERIFIED: docs/PRD_frontend_v1.1.md via 03-CONTEXT.md canonical refs]

### Perguntas Pendentes

1. **Onde armazenar `federal_tax_id` no cart/address?**
   - What we know: Phase 03 exige coletar e validar `federal_tax_id` para `checkout_data_complete`. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
   - What's unclear: se Medusa address atual tem campo first-class suficiente ou se sera necessario `metadata`/`additional_data` com politica de mascaramento. [ASSUMED]
   - Recommendation: gate manual no plano antes de persistir CPF/CNPJ completo; preferir menor exposicao e testes de nao-log. [VERIFIED: .planning/phases/01-foundation-observability/01-CONTEXT.md]

2. **Como marcar cart antigo como nao ativo sem migration?**
   - What we know: D-03 exige que cart anterior deixe de ser ativo e nao seja deletado. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
   - What's unclear: se sera possivel representar isso apenas com core Medusa/metadata existente sem schema novo. [ASSUMED]
   - Recommendation: planner deve incluir spike/checkpoint tecnico curto antes de comprometer implementacao; se exigir migration, parar para aprovacao humana. [VERIFIED: tarefa do usuario]

3. **Contrato de sessao para guest cart atual**
   - What we know: attach so deve considerar guest cart da sessao atual. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
   - What's unclear: se a storefront futura usara cookie, localStorage ou outro identificador para enviar o cart atual. [ASSUMED]
   - Recommendation: API deve aceitar cart id explicito apenas com autorizacao/validacao da sessao atual; decisao fina deve ser revisada no plano. [ASSUMED]

**Blocking assessment:** nenhuma decisao tecnica pendente bloqueia a criacao do plano, desde que o planner insira gates manuais nos tres pontos acima e preserve a parada manual antes de execucao. [VERIFIED: .planning/STATE.md]

## State of the Art / Outdated Approaches

| Old/Unsafe Approach | Current Approach | Impact |
|---------------------|------------------|--------|
| Chamar `completeCart` no fim do checkout. | Manter Phase 03 apenas como coleta de dados; Order nasce so em fase posterior por webhook confirmado. [VERIFIED: .planning/research/ARCHITECTURE.md] [CITED: Context7 /medusajs/medusa Complete Cart] | Evita Order pre-pagamento e preserva Pix async. |
| Persistir `ready_for_payment`. | Calcular `checkout_data_complete` por resposta. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md] | Evita estado stale e semantica prematura da Phase 04. |
| Validar CEP por servico externo no MVP. | Validacao estrutural local BR/CEP/UF/CPF/CNPJ. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md] | Mantem fase pequena e sem dependencia externa. |
| Revalidar Gelato profundo no checkout. | Reusar vendabilidade/publicacao da Phase 02. [VERIFIED: .planning/phases/02-catalog-media/02-CONTEXT.md] | Evita divergencia entre catalogo e checkout. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Pode ser necessario escolher entre campo nativo de address e `metadata`/`additional_data` para `federal_tax_id`. | Perguntas Pendentes | Persistencia de CPF/CNPJ pode ficar inconsistente ou expor PII mais que o necessario. |
| A2 | Pode nao haver representacao nativa suficiente para "cart antigo nao ativo" sem schema novo. | Riscos/Perguntas Pendentes | Planner pode precisar de migration, que exige gate manual e altera escopo. |
| A3 | O contrato de sessao do guest cart dependera da storefront futura. | Perguntas Pendentes | Attach pode aceitar cart errado se nao houver validacao de sessao. |

## Fontes Lidas

### Projeto e decisoes
- `.planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md` - decisoes canonicas D-01..D-33, discretion e deferred. [VERIFIED: repo]
- `.planning/ROADMAP.md` - Phase 3 goal, requirements e success criteria. [VERIFIED: repo]
- `.planning/REQUIREMENTS.md` - CART-01..CART-04. [VERIFIED: repo]
- `.planning/STATE.md` - manual-review gate e estado atual. [VERIFIED: repo]
- `.planning/phases/02-catalog-media/02-CONTEXT.md` - fronteira de catalogo/vendabilidade e deferred de Order/LineItem. [VERIFIED: repo]
- `.planning/phases/01-foundation-observability/01-CONTEXT.md` - logs/redaction/webhook boundary e operacao. [VERIFIED: repo]
- `.planning/research/ARCHITECTURE.md` - cart como estado pre-Order e arquitetura webhook-driven. [VERIFIED: repo]
- `.planning/research/PITFALLS.md` - anti-pattern de criar Order em completeCart. [VERIFIED: repo]
- `.planning/research/STACK.md` - stack Medusa v2/Node/TS/BRL e limites de pagamento/fulfillment. [VERIFIED: repo]
- `AGENTS.md` - instrucoes de projeto, stack e GSD workflow enforcement. [VERIFIED: repo]
- `.planning/config.json` - nyquist validation e security enforcement habilitados. [VERIFIED: repo]

### Codigo local
- `apps/backend/src/api/middlewares.ts` - middlewares, logging, Sentry e Store/Admin route wiring. [VERIFIED: repo]
- `apps/backend/src/api/store/products/query-config.ts` - query config Store API. [VERIFIED: repo]
- `apps/backend/src/api/store/products/serializers.ts` - serializer publico e filtro de variantes vendaveis. [VERIFIED: repo]
- `apps/backend/src/api/admin/products/validators.ts` - mensagens seguras e canarios. [VERIFIED: repo]
- `apps/backend/medusa-config.ts` - config central Medusa. [VERIFIED: repo]
- `apps/backend/src/workflows/catalog/validate-sellable-variant.ts` - `isSellableVariant` e workflow hook local. [VERIFIED: repo]
- `apps/backend/src/modules/catalog/gelato-metadata.ts` - helper central de metadata/preco BRL. [VERIFIED: repo]
- `apps/backend/package.json` e `apps/backend/jest.config.js` - versoes e comandos de teste. [VERIFIED: repo]
- `apps/backend/integration-tests/http/catalog-store.spec.ts` e `catalog-admin.spec.ts` - padroes de integration test. [VERIFIED: repo]

### Documentacao atual Medusa
- Context7 `/medusajs/medusa` - `POST /store/carts`, `POST /store/carts/{cartId}`, `transferCart(cartId)`, `completeCart` e `/store/carts/:id/complete`. [CITED: Context7 /medusajs/medusa]
- Context7 `/websites/medusajs_resources` - `defineMiddlewares`, `validateAndTransformBody`, Zod e `additionalDataValidator` para extensao de `/store/carts`. [CITED: docs.medusajs.com/resources/commerce-modules/cart/extend]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - versoes verificadas em `apps/backend/package.json`; nenhum pacote novo. [VERIFIED: apps/backend/package.json]
- Architecture: HIGH - escopo e fronteiras confirmados em CONTEXT/ROADMAP/ARCHITECTURE/PITFALLS. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md]
- Medusa route specifics: MEDIUM - confirmados por Context7/docs, mas sem implementacao local ainda para cart. [CITED: Context7 /medusajs/medusa]
- Pitfalls/security: HIGH - padroes locais de observabilidade e Phase 02 foram lidos no codigo. [VERIFIED: apps/backend/src/api/middlewares.ts]

**Research date:** 2026-06-27
**Valid until:** 2026-07-27 para decisoes de produto e padroes locais; revisar docs Medusa se a implementacao ocorrer apos upgrades de `@medusajs/*`.
