# PRD — Frontend Storefront da Indicio Cult

| Campo | Valor |
|---|---|
| Documento | Product Requirements Document — Frontend |
| Projeto | E-commerce headless Print-on-Demand da Indicio Cult |
| Versão | 1.1.2 — decisões do Gate de Contratos incorporadas |
| Data da revisão | 2026-08-05 |
| Status | Canônico de decisões — `DECISIONS COMPLETE, ARTIFACTS PENDING` |
| Responsável | Jefferson |
| Base | PRD Backend v1.1 · SRS v1.5 · Store OpenAPI atual · decisões dos Blocos A–J e R |
| Stack planejada | Next.js App Router · TypeScript · Tailwind CSS · Vercel · Stripe.js · PostHog · Sentry |
| Mercado inicial | Brasil |
| Moeda | BRL |
| Backend | Medusa v2 no Heroku |

> **Estado da Etapa 0:** os fluxos, limites, contratos-alvo e decisões arquiteturais estão aprovados. Os artefatos executáveis ainda precisam ser materializados: PRD Backend, SRS, Store OpenAPI, Webhooks OpenAPI, matriz de rastreabilidade, tipos, schemas Zod, mocks e contract tests.

> **Autoridade contratual:** o Store OpenAPI versionado é a fonte de verdade para as operações BFF → Medusa. Este PRD define jornadas, comportamento do BFF e experiência da storefront. Nenhum endpoint-alvo descrito neste documento poderá ser consumido antes de existir no OpenAPI aprovado.

> **Regra central:** a storefront nunca cria, confirma ou infere um `Order`. O `Order` somente existe após confirmação canônica do pagamento pelo backend e processamento idempotente do webhook da Stripe.

---

## Sumário

1. [Resumo executivo](#1-resumo-executivo)
2. [Objetivos e métricas](#2-objetivos-e-métricas)
3. [Escopo do Milestone 1](#3-escopo-do-milestone-1)
4. [Usuários e jornadas](#4-usuários-e-jornadas)
5. [Arquitetura do frontend e BFF](#5-arquitetura-do-frontend-e-bff)
6. [Contrato atual do backend](#6-contrato-atual-do-backend)
7. [Contrato-alvo aprovado](#7-contrato-alvo-aprovado)
8. [Arquitetura de informação e páginas](#8-arquitetura-de-informação-e-páginas)
9. [Fluxos detalhados](#9-fluxos-detalhados)
10. [Requisitos funcionais](#10-requisitos-funcionais)
11. [Estados de interface e erros](#11-estados-de-interface-e-erros)
12. [Dinheiro e formatação](#12-dinheiro-e-formatação)
13. [Autenticação e sessão](#13-autenticação-e-sessão)
14. [Analytics e observabilidade](#14-analytics-e-observabilidade)
15. [Segurança, privacidade e retenção](#15-segurança-privacidade-e-retenção)
16. [Acessibilidade, desempenho e SEO](#16-acessibilidade-desempenho-e-seo)
17. [Estratégia de integração e contratos](#17-estratégia-de-integração-e-contratos)
18. [Testes](#18-testes)
19. [Ordem de implementação](#19-ordem-de-implementação)
20. [Critérios de aceite](#20-critérios-de-aceite)
21. [Pendências de materialização](#21-pendências-de-materialização)
22. [Referências](#22-referências)

---

## 1. Resumo executivo

A storefront da Indicio Cult será a interface pública de descoberta e compra do e-commerce Print-on-Demand. No primeiro milestone, o produto entregará uma jornada completa de compra por cartão:

```text
Home
→ catálogo
→ produto
→ carrinho convidado
→ autenticação obrigatória
→ merge/anexação do carrinho
→ checkout brasileiro
→ frete
→ Stripe Payment Element
→ confirmação assíncrona
→ pedido confirmado
```

O visitante pode navegar e adicionar itens antes de autenticar. A autenticação é obrigatória antes de entrar nas etapas de endereço, frete e pagamento.

O frontend será um repositório Next.js independente do backend e operará por meio de um BFF same-origin. O navegador não chamará o Medusa diretamente. O BFF:

- gerencia cookies `HttpOnly`;
- mantém a publishable key do Medusa no servidor;
- encaminha JWT;
- valida respostas upstream com Zod;
- converte contratos upstream em DTOs próprios;
- protege capabilities, tokens, `client_secret` e dados pessoais;
- centraliza idempotência, concorrência, timeouts e correlation IDs.

Princípios obrigatórios:

1. **Contrato primeiro:** somente operações presentes no OpenAPI aprovado.
2. **BFF estrito:** navegador → BFF → Medusa.
3. **Backend autoritativo:** preços, totais, elegibilidade, estado financeiro e existência do pedido.
4. **Cliente não confiável:** valores, IDs internos e estados financeiros não são aceitos do navegador.
5. **Dados sensíveis efêmeros:** secrets e capabilities nunca entram em analytics, logs ou storage do navegador.
6. **Confirmação assíncrona:** sucesso client-side da Stripe não é confirmação de pedido.
7. **Recuperação segura:** retries preservam idempotência e nunca geram cobrança duplicada.

---

## 2. Objetivos e métricas

### 2.1 Objetivos

- oferecer experiência editorial coerente com a identidade da Indicio Cult;
- permitir descoberta e carrinho antes da autenticação;
- exigir conta antes do checkout;
- preservar e mesclar o carrinho convidado no login;
- coletar endereço brasileiro, telefone e CPF com minimização de dados;
- calcular e selecionar frete por contrato autoritativo do backend;
- confirmar cartão exclusivamente com Stripe Payment Element;
- suportar 3DS e retorno seguro;
- aguardar criação real do `Order`;
- manter refresh e múltiplas abas seguros;
- instrumentar o funil sem expor PII ou duplicar receita;
- permitir desenvolvimento por mocks após a materialização dos contratos executáveis.

### 2.2 Métricas de sucesso

- zero `Order` exibido antes da criação no backend;
- zero cobrança iniciada com total, frete ou versão de carrinho desatualizados;
- zero `client_secret`, `guestCartToken`, confirmation token, CPF ou JWT em logs/analytics/storage;
- zero emissão frontend de `purchase_completed`;
- 100% das operações BFF → Medusa presentes no Store OpenAPI;
- 100% das respostas upstream críticas validadas em runtime;
- 100% das mutações definidas como idempotentes usando `Idempotency-Key`;
- fluxos de catálogo, carrinho, autenticação, checkout, frete, cartão e confirmação cobertos por testes;
- conflitos de versão tratados sem repetição destrutiva automática;
- Core Web Vitals dentro das metas das páginas públicas.

---

## 3. Escopo do Milestone 1

### 3.1 Incluído

- home institucional e comercial;
- catálogo;
- página de produto;
- seleção de variante;
- carrinho convidado;
- carrinho autenticado;
- criação lazy do carrinho no primeiro “Adicionar ao carrinho”;
- cadastro;
- login;
- logout;
- recuperação e redefinição de senha;
- verificação flexível de e-mail;
- merge/anexação de carrinhos;
- checkout autenticado para pessoa física no Brasil;
- endereço estruturado;
- CPF;
- consulta de CEP via BFF;
- consentimentos;
- cotação e seleção de frete;
- pagamento por cartão com Stripe Payment Element;
- 3DS;
- confirmação assíncrona;
- página de pedido confirmado;
- páginas legais;
- canal de suporte;
- PostHog frontend;
- Sentry frontend;
- acessibilidade, SEO e layout mobile-first.

### 3.2 Fora do escopo

- checkout convidado;
- Pix no frontend;
- tracking público;
- histórico/listagem de pedidos;
- endereços salvos;
- cupons, promoções e gift cards;
- pedidos de total zero;
- frete grátis como regra comercial;
- solicitação automatizada de troca;
- conta empresarial e CNPJ;
- métodos além de cartão;
- Admin customizado;
- editor de produtos;
- upload de arte;
- personalização dinâmica;
- reviews;
- chat;
- afiliados;
- múltiplos países ou moedas;
- aplicação mobile nativa.

### 3.3 Posterior

- Pix após elegibilidade e fase própria;
- histórico e detalhes persistentes da conta;
- endereços salvos;
- cupons e promoções;
- tracking público;
- trocas automatizadas;
- logout de todos os dispositivos;
- pedidos gratuitos;
- fallback logístico;
- métodos adicionais da Stripe.

---

## 4. Usuários e jornadas

| Perfil | Necessidade | Autorização |
|---|---|---|
| Visitante | navegar e criar carrinho | publishable key + capability do carrinho convidado |
| Cliente em cadastro | criar identidade e Customer | rotas `/auth` + registration JWT |
| Cliente autenticado | concluir checkout e consultar confirmação | publishable key + Customer JWT |
| Operador | tratar reconciliação e suporte | fora da storefront |

### 4.1 Jornada primária

```text
Descoberta
→ catálogo
→ produto
→ variante
→ adicionar ao carrinho
→ carrinho
→ login/cadastro obrigatório
→ merge do carrinho
→ checkout
→ endereço e CPF
→ frete
→ cartão
→ processamento
→ pedido confirmado
```

### 4.2 Barreira de autenticação

O visitante pode:

- navegar;
- selecionar variante;
- adicionar, alterar e remover itens;
- visualizar o carrinho.

O visitante não pode:

- entrar em endereço;
- cotar/selecionar frete;
- criar `PaymentAttempt`;
- confirmar pagamento.

Tentativa de acessar `/checkout` sem sessão válida:

```text
→ redirecionar para /entrar?returnUrl=/checkout
→ preservar carrinho convidado
→ autenticar
→ executar merge
→ retornar ao checkout
```

### 4.3 Verificação flexível de e-mail

- o e-mail de verificação é solicitado no cadastro;
- a conta pode comprar durante a sessão inicial mesmo sem verificação;
- após logout ou expiração completa, novo login exige e-mail verificado;
- compra não é bloqueada por falha no envio do e-mail;
- o frontend não envia e-mails diretamente.

---

## 5. Arquitetura do frontend e BFF

### 5.1 Topologia

```text
Navegador
  │
  ▼
Next.js App Router — www.indiciocult.com.br
  ├── Server Components
  ├── Client Components
  ├── Server Actions
  ├── Route Handlers
  ├── BFF same-origin
  ├── adapters + Zod
  ├── PostHog
  └── Sentry
  │
  ▼ HTTPS
Medusa — api.indiciocult.com.br
```

Domínios:

- `indiciocult.com.br`: raiz;
- `www.indiciocult.com.br`: storefront;
- `api.indiciocult.com.br`: backend;
- `admin.indiciocult.com.br`: Admin.

### 5.2 BFF estrito

O navegador não chama o Medusa diretamente.

O BFF:

- guarda `x-publishable-api-key` server-side;
- resolve cookies;
- injeta `Authorization`;
- injeta `x-indicio-guest-cart-token`;
- cria `Idempotency-Key`;
- propaga `If-Match`;
- normaliza erros;
- aplica timeout;
- gera/propaga `x-correlation-id`;
- valida responses com Zod;
- adapta respostas para DTOs internos.

### 5.3 Anti-Corruption Layer

```text
Store OpenAPI
→ tipos gerados
→ Zod runtime
→ adapter
→ DTOs próprios
→ componentes
```

Componentes React não importam tipos Medusa.

Contrato browser → BFF:

- TypeScript e Zod internos;
- sem OpenAPI próprio no Milestone 1;
- Server Actions para mutações de árvore/formulário;
- Route Handlers quando Client Components precisam de HTTP/polling.

### 5.4 Renderização

| Página/recurso | Estratégia |
|---|---|
| Home | ISR + Server Components + ilhas client |
| Catálogo | ISR + Server Components |
| Produto | ISR + ilhas client |
| Mini-carrinho | CSR |
| Carrinho | shell dinâmico + interações CSR |
| Checkout | dinâmico, `no-store` |
| Conta/autenticação | dinâmico, `no-store` |
| Processamento | dinâmico, `no-store` |
| Pedido confirmado | dinâmico, `no-store` |
| Legais | estático |

### 5.5 Revalidação do catálogo

Evento Medusa → Next.js:

```text
POST /api/webhooks/medusa/catalog-revalidation
```

Headers:

- `x-indicio-event-id`;
- `x-indicio-event-type`;
- `x-indicio-signature`;
- `x-indicio-timestamp`.

Tags:

- `catalog`;
- `product:<id>`.

Respostas:

- `202 Accepted`: assinatura validada, evento deduplicado e persistido, job durável enfileirado;
- `200 OK`: `revalidateTag` concluído sincronamente.

### 5.6 CSP

- páginas ISR usam CSP estática compatível com cache;
- carrinho, checkout, conta e confirmação usam CSP dinâmica com nonce;
- Stripe.js é carregado somente na etapa de pagamento;
- scripts não essenciais são bloqueados durante o pagamento.

---

## 6. Contrato atual do backend

O Store OpenAPI atual possui dez operações documentadas. Elas representam o estado as-built, não o contrato-alvo completo.

| operationId | Método e rota | Estado |
|---|---|---|
| `healthLive` | `GET /health/live` | existente |
| `healthReady` | `GET /health/ready` | existente |
| `listStoreProducts` | `GET /store/products` | existente |
| `getStoreProduct` | `GET /store/products/{id}` | existente |
| `getActiveStoreCart` | `GET /store/carts/active` | existente |
| `createActiveStoreCart` | `POST /store/carts/active` | existente; será estendido |
| `attachCustomerCart` | `POST /store/customers/me/cart/attach` | existente; será deprecated |
| `createCardPaymentAttempt` | `POST /store/carts/{id}/payment-attempts/card` | existente; será estendido |
| `createPixPaymentAttempt` | `POST /store/carts/{id}/payment-attempts/pix` | existente; fora do milestone |
| `lookupTracking` | `POST /store/tracking/lookup` | existente; fora do milestone |

Regras atuais de dinheiro:

- catálogo/carrinho: `brl-major`;
- `PaymentAttempt.amount`: `brl-minor`.

O BFF preservará o upstream atual e normalizará os DTOs internos em minor units.

---

## 7. Contrato-alvo aprovado

As operações desta seção estão **aprovadas como decisão**, mas somente poderão ser consumidas quando materializadas no OpenAPI.

### 7.1 Autenticação

| operationId | Método | Rota | Classificação |
|---|---|---|---|
| `registerCustomerIdentity` | `POST` | `/auth/customer/emailpass/register` | nativa |
| `createCustomer` | `POST` | `/store/customers` | nativa |
| `customerLogin` | `POST` | `/auth/customer/emailpass` | nativa + guard |
| `getCustomerMe` | `GET` | `/store/customers/me` | nativa |
| `requestPasswordReset` | `POST` | `/auth/customer/emailpass/reset-password` | nativa, Medusa 2.16+ |
| `resetPassword` | `POST` | `/auth/customer/emailpass/update` | nativa |
| `refreshCustomerToken` | `POST` | `/auth/token/refresh` | nativa + guard |
| `requestEmailVerification` | `POST` | `/store/customers/me/verify` | customizada |
| `resendEmailVerification` | `POST` | `/store/customers/me/verify/resend` | customizada |
| `confirmEmailVerification` | `POST` | `/store/customers/verify` | customizada |
| `getEmailVerificationStatus` | `GET` | `/store/customers/me/verify/status` | customizada |

`customerLogout` é operação do BFF, não integra o Store OpenAPI.

### 7.2 Carrinho

| operationId | Método | Rota |
|---|---|---|
| `getActiveStoreCart` | `GET` | `/store/carts/active` |
| `createActiveStoreCart` | `POST` | `/store/carts/active` |
| `addCartLineItem` | `POST` | `/store/carts/{id}/line-items` |
| `updateCartLineItem` | `POST` | `/store/carts/{id}/line-items/{item_id}` |
| `removeCartLineItem` | `DELETE` | `/store/carts/{id}/line-items/{item_id}` |
| `clearCartLineItems` | `DELETE` | `/store/carts/{id}/line-items` |
| `mergeCustomerCart` | `POST` | `/store/customers/me/cart/merge` |
| `acknowledgeCartReview` | `POST` | `/store/carts/{id}/review/acknowledge` |

`attachCustomerCart` fica deprecated e não será usado pelo novo frontend.

### 7.3 Checkout

| operationId | Método | Rota |
|---|---|---|
| `patchCartCheckoutDetails` | `PATCH` | `/store/carts/{id}/checkout-details` |
| `validateCartCheckoutDetails` | `POST` | `/store/carts/{id}/checkout-details/validate` |

Busca de CEP é BFF-only e não integra o Store OpenAPI.

### 7.4 Frete

| operationId | Método | Rota |
|---|---|---|
| `quoteShippingOptions` | `POST` | `/store/carts/{id}/shipping-options/quote` |
| `selectShippingOption` | `PUT` | `/store/carts/{id}/shipping-option` |

### 7.5 Pagamento e confirmação

| operationId | Método | Rota |
|---|---|---|
| `createCardPaymentAttempt` | `POST` | `/store/carts/{id}/payment-attempts/card` |
| `getPaymentAttemptStatus` | `POST` | `/store/carts/{id}/payment-attempts/status` |
| `invalidatePaymentAttempt` | `POST` | `/store/carts/{id}/payment-attempts/invalidate` |
| `getPaymentConfirmationStatus` | `POST` | `/store/payment-confirmations/status` |
| `getConfirmedOrderSummary` | `GET` | `/store/orders/{orderReference}/confirmation` |

### 7.6 Headers transversais

| Header | Uso |
|---|---|
| `x-publishable-api-key` | rotas `/store` |
| `Authorization` | JWT de Customer ou token específico |
| `x-indicio-guest-cart-token` | capability do carrinho convidado |
| `If-Match` | concorrência |
| `ETag` | versão retornada |
| `Idempotency-Key` | mutações repetíveis |
| `x-correlation-id` | rastreabilidade |
| `Retry-After` | rate limit e polling |
| `Content-Type` | `application/json` |

### 7.7 Contexto do carrinho convidado

```ts
type GuestCartEnvelope = {
  cartId: string
  guestCartToken: string
  createdAt: string
  version: number
}
```

Criação:

```http
POST /store/carts/active
```

Resposta:

```http
201 Created
ETag: "<cart-version>"
x-indicio-guest-cart-token: "<opaque-capability>"
```

Regras:

- token com 32 bytes CSPRNG;
- backend armazena somente SHA-256;
- BFF guarda o valor dentro de `indicio_cart_id`;
- browser JavaScript nunca recebe o token;
- header marcado com `x-sensitive: true`;
- merge consome e revoga a capability;
- mesma `Idempotency-Key` retorna o mesmo contexto válido.

### 7.8 Schemas canônicos

O registry deverá incluir, no mínimo:

- `StoreMajorMoney`;
- `StoreMinorMoney`;
- `MoneyUnit`;
- `StoreCartResponse`;
- `CartMergeRequest`;
- `CartMergeResponse`;
- `CartMergeRejectedItem`;
- `CheckoutDetailsDraftRequest`;
- `CheckoutDetailsDraftResponse`;
- `CheckoutValidationRequest`;
- `CheckoutValidationResponse`;
- `BrazilianShippingAddress`;
- `MaskedFederalTaxId`;
- `ConsentReceipt`;
- `CartReviewState`;
- `ShippingQuoteRequest`;
- `ShippingQuoteResponse`;
- `ShippingOption`;
- `ShippingSelectionRequest`;
- `CardPaymentAttemptRequest`;
- `CardPaymentAttemptResponse`;
- `PaymentAttemptStatusRequest`;
- `PaymentAttemptStatusResponse`;
- `PaymentAttemptInvalidationRequest`;
- `PaymentAttemptInvalidationResponse`;
- `PaymentConfirmationStatusRequest`;
- `PaymentConfirmationStatusResponse`;
- `ConfirmedOrderItem`;
- `ConfirmedOrderSummary`;
- `StoreErrorResponse`;
- `AuthVerificationState`;
- schemas de identidade, senha, token e Customer definidos no Bloco R.

---

## 8. Arquitetura de informação e páginas

| Página | Rota | Milestone 1 |
|---|---|---|
| Home | `/` | incluída |
| Catálogo | `/produtos` | incluída |
| Produto | `/produtos/[handle-ou-id]` | incluída; resolução final conforme contrato |
| Carrinho | `/carrinho` | incluída |
| Login | `/entrar` | incluída |
| Cadastro | `/cadastro` | incluída |
| Recuperação | `/recuperar-senha` | incluída |
| Redefinição | `/redefinir-senha` | incluída |
| Verificação | `/verificar-email` | incluída |
| Checkout | `/checkout` | incluída; autenticada |
| Processamento | `/checkout/processando` | incluída |
| Pedido confirmado | `/pedidos/[orderReference]/confirmacao` | incluída |
| Privacidade | `/privacidade` | incluída |
| Termos | `/termos` | incluída |
| Trocas | `/trocas` | incluída |
| Contato | `/contato` | incluída |
| Histórico de pedidos | `/conta/pedidos` | posterior |
| Tracking público | `/rastreio` | posterior |

Rotas de checkout, conta e confirmação usam `noindex`.

---

## 9. Fluxos detalhados

### 9.1 Catálogo e produto

```text
Usuário abre catálogo/produto
→ Server Component chama BFF
→ BFF chama Store API
→ Zod valida resposta
→ adapter converte preços
→ UI renderiza apenas variantes vendáveis
```

A UI nunca acessa metadata Gelato.

### 9.2 Criação e recuperação do carrinho

- `GET /api/cart` resolve `indicio_cart_id`;
- BFF chama `GET /store/carts/active`;
- `404`: limpa cookie stale e retorna carrinho vazio;
- não cria carrinho ao abrir a página;
- primeiro “Adicionar” chama criação + adição;
- criação e adição usam subchaves de uma raiz UUID:
  - `<uuid>:create`;
  - `<uuid>:add`.

Falha na adição preserva o carrinho vazio criado.

### 9.3 Mutações do carrinho

Input:

```ts
type AddCartItemInput = {
  variantId: string
  quantity: number
}
```

Regras:

- quantidade inteira entre 1 e 99;
- preço, produto, metadata e cart ID enviados pelo browser são ignorados/rejeitados;
- quantidade `0` remove o item;
- UI otimista híbrida;
- debounce de quantidade: 300 ms;
- conflito de `ETag`: `412 CART_VERSION_MISMATCH`;
- sem repetição automática destrutiva;
- resposta substitui o estado local pelo `CartDTO` canônico.

### 9.4 Merge

```text
Login/cadastro concluído
→ BFF mantém o carrinho convidado
→ chama mergeCustomerCart
→ backend transaciona
→ capability convidada é consumida
→ resposta informa outcome e rejeições
→ UI apresenta revisão quando necessário
```

Outcomes:

- `MERGED`;
- `MERGED_PARTIAL`;
- `GUEST_CART_ATTACHED`;
- `CUSTOMER_CART_PRESERVED`;
- `NO_ITEMS`.

Quantidades do mesmo variant são somadas e limitadas a 99. Itens inválidos são rejeitados individualmente.

`requiresReview=true` bloqueia checkout até reconhecimento persistido.

### 9.5 Autenticação

Cadastro:

```text
registerCustomerIdentity
→ registration JWT
→ createCustomer
→ sessão inicial
→ solicitar verificação
→ merge
```

Login:

- backend aplica verificação flexível;
- e-mail não verificado só pode usar a sessão inicial;
- novo login após encerramento exige verificação;
- `returnUrl` é allowlisted.

Logout:

- limpa `indicio_session_jwt`;
- limpa `indicio_cart_id`;
- limpa caches client-side;
- publica evento entre abas;
- carrinho autenticado permanece ligado ao Customer no backend.

### 9.6 Sessão

Cookie:

```text
Name: indicio_session_jwt
HttpOnly: true
Secure: true em staging/prod
SameSite: Lax
Domain: omitido — host-only
```

Envelope:

```ts
type AuthSessionEnvelope = {
  jwt: string
  originalLoginAt: string
  lastActivityAt: string
}
```

Regras:

- JWT: 24 horas;
- renovar quando faltarem menos de 60 minutos;
- cookie rolling: 7 dias;
- inatividade: 7 dias;
- duração absoluta: 30 dias;
- JWT expirado exige login;
- alteração de senha revoga tokens anteriores;
- logout afeta o dispositivo atual.

### 9.7 Checkout

Pré-condições:

- sessão válida;
- Customer;
- carrinho associado e não vazio;
- merge concluído;
- `requiresReview=false`;
- itens vendáveis;
- e-mail da conta;
- nenhum pagamento incompatível.

Draft:

```http
PATCH /store/carts/{id}/checkout-details
If-Match: "<etag>"
Idempotency-Key: "<uuid>"
```

- persiste campos presentes e válidos;
- CPF inválido não é persistido;
- recalcula completude;
- conflito retorna `412`.

Validação final:

```http
POST /store/carts/{id}/checkout-details/validate
If-Match: "<etag>"
Idempotency-Key: "<uuid>"
```

- valida a etapa completa;
- não persiste parcialmente em caso de erro;
- retorna todos os `fieldErrors`;
- libera frete/pagamento somente após sucesso.

### 9.8 Dados brasileiros

Campos obrigatórios:

- nome;
- sobrenome;
- e-mail da conta, read-only;
- telefone;
- CPF;
- CEP;
- rua;
- número ou `S/N`;
- bairro;
- cidade;
- UF;
- país `BR`.

Complemento é opcional.

Mapeamento Medusa:

```text
address_1 = street + ", " + number + complemento opcional
address_2 = neighborhood
```

O domínio mantém campos estruturados.

### 9.9 CEP

```text
browser
→ BFF
→ ViaCEP
→ fallback BrasilAPI
```

- timeout por tentativa: 3 s;
- uma tentativa + retry/fallback controlado;
- resultado é sugestão;
- preenchimento manual permanece disponível;
- cache positivo: 30 dias;
- não encontrado: 1 hora;
- CEP não entra em analytics;
- `source` pode ser exibido na UI.

### 9.10 CPF

- validação client-side e backend;
- campo próprio criptografado com AES-256-GCM;
- chave gerenciada por KMS/serviço equivalente;
- Store API retorna somente mascarado;
- cart abandonado: purge após 7 dias;
- snapshot criptografado no `Order`;
- acesso completo apenas por fluxos autorizados e auditados;
- proibido em browser storage, URL, logs, Sentry, PostHog, Stripe e Gelato.

### 9.11 Consentimentos

- Termos de Compra: aceite contratual;
- Política de Trocas: enquadramento jurídico pendente;
- Política de Privacidade: ciência/transparência;
- consentimentos opcionais são separados por finalidade.

O backend registra versões, timestamp, Customer, cart, IP legalmente necessário e correlation ID. User agent não é armazenado.

Revisão jurídica é gate de go-live.

### 9.12 Frete

Cotação automática após endereço completo:

```http
POST /store/carts/{id}/shipping-options/quote
If-Match: "<etag>"
Idempotency-Key: "<uuid>"
```

- backend é autoritativo;
- BFF cache read-through máximo de 5 minutos;
- TTL da cotação: máximo de 30 minutos;
- provider oculto;
- transportadora somente quando disponível;
- preço em BRL;
- prazo total estimado em dias úteis;
- mudança de endereço/item/preço revoga a cotação;
- opção anterior nunca é restaurada automaticamente.

Seleção:

```http
PUT /store/carts/{id}/shipping-option
If-Match: "<etag>"
Idempotency-Key: "<uuid>"
```

- exige `shippingOptionRef` opaca e vigente;
- recalcula totais;
- exige nova seleção após mudança;
- invalida `PaymentAttempt` incompatível.

Sem fallback logístico no Milestone 1.

### 9.13 Pagamento por cartão

Iniciação por Server Action:

```ts
type StartCardPaymentInput = {
  cartEtag: string
}
```

```text
Client Component
→ Server Action
→ If-Match no fetch BFF → Medusa
→ cria/recupera PaymentAttempt compatível
→ retorna client_secret em memória
→ monta Payment Element
```

Pré-condições:

- checkout completo;
- frete válido;
- consentimentos válidos;
- total > 0;
- versão atual;
- nenhuma tentativa incompatível;
- nenhum pagamento em processamento.

O browser nunca envia:

- amount;
- currency;
- cart/customer/order ID;
- PaymentIntent ID;
- preço ou totais.

### 9.14 Stripe

- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` pode estar no navegador;
- secret key permanece no backend;
- PAN/CVC trafegam entre Stripe Elements e Stripe;
- `client_secret` somente em memória;
- `redirect: "if_required"`;
- 3DS suportado;
- sucesso client-side leva a processamento, nunca a “pedido confirmado”.

Estados reutilizáveis:

- `requires_payment_method`;
- `requires_confirmation`;
- `requires_action` continua a mesma tentativa.

Estados bloqueados:

- `processing`;
- `succeeded`;
- `canceled`;
- `invalidated`;
- `expired`.

Erro de rede após confirmação:

```text
→ não repetir confirmPayment
→ consultar status
→ entrar em confirmação assíncrona
```

### 9.15 Invalidação do pagamento

Mudança de carrinho/endereço/frete:

```text
→ invalida PaymentAttempt
→ desmonta Elements
→ descarta client_secret
→ tenta cancelar PaymentIntent best effort
→ cria nova tentativa quando permitido
```

Webhook tardio de tentativa invalidada:

```text
→ ingerir e deduplicar
→ responder 2xx
→ não criar Order com carrinho atual
→ PAYMENT_SUCCEEDED_FOR_INVALIDATED_ATTEMPT
→ reconciliation required
→ alerta crítico
→ revisão administrativa em até 24 horas
```

### 9.16 Confirmação assíncrona

Retorno:

```text
Stripe
→ /checkout/processando?token=<confirmationToken>
→ Next.js troca token server-side
→ cria indicio_confirmation_session
→ redirect para URL limpa
→ polling
```

Token:

- 32 bytes CSPRNG;
- backend armazena somente SHA-256;
- uso único;
- TTL 30 minutos;
- vinculado a Customer, tentativa e versão do carrinho.

Cookie:

```text
Name: indicio_confirmation_session
HttpOnly: true
Secure: true
SameSite: Lax
Path: /
Domain: omitido — host-only
Max-Age: 1800
```

Polling:

- início em 2 s;
- orientado por `retryAfterMs`;
- progressão 2/4/8 s;
- máximo de 10 s;
- ativo até 60 s;
- pausa em aba oculta;
- consulta imediata no foco;
- após 60 s: `CONFIRMATION_UNKNOWN`;
- botão de nova cobrança permanece bloqueado.

### 9.17 Estados da confirmação

```ts
type PaymentConfirmationStatus =
  | "AWAITING_PROVIDER"
  | "PROCESSING_WEBHOOK"
  | "ORDER_CONFIRMED"
  | "PAYMENT_RETRY_REQUIRED"
  | "PAYMENT_CANCELED"
  | "PAYMENT_INVALIDATED"
  | "PAYMENT_EXPIRED"
  | "RECONCILIATION_REQUIRED"
  | "CONFIRMATION_SESSION_EXPIRED"
  | "CONFIRMATION_UNKNOWN"
```

- `ORDER_CONFIRMED`: terminal;
- `PAYMENT_RETRY_REQUIRED`: encerra a jornada atual e permite correção;
- `RECONCILIATION_REQUIRED`: encerra polling automático, mantém lock;
- `CONFIRMATION_UNKNOWN`: terminal de UX, não terminal financeiro.

### 9.18 Criação do Order

```text
payment_intent.succeeded
→ WebhookEventLog deduplica
→ snapshot da tentativa é validado
→ Order é criada transacionalmente
→ Payment e Order são vinculados
→ outbox registra efeitos
→ purchase_completed é emitido pelo backend
→ e-mail é enfileirado
→ confirmação passa a ORDER_CONFIRMED
```

E-mail e analytics não bloqueiam a resposta de `ORDER_CONFIRMED`.

### 9.19 Página confirmada

```http
GET /store/orders/{orderReference}/confirmation
```

- publishable key + Customer JWT;
- proprietário obrigatório;
- `orderReference` não sequencial;
- referência isolada não concede acesso;
- TTL de acesso direto: 24 horas;
- outro dispositivo funciona quando autenticado na mesma conta;
- após TTL: `404 CONFIRMATION_NOT_FOUND`.

A página exibe resumo reduzido, endereço necessário, CEP/e-mail mascarados e nenhuma referência Stripe.

### 9.20 Limpeza e múltiplas abas

Quando `ORDER_CONFIRMED`:

- backend completa carrinho;
- BFF limpa `indicio_cart_id`;
- snapshot local é removido;
- caches são invalidados;
- `BroadcastChannel` publica `order-confirmed` e `cart-cleared`;
- outras abas desmontam Elements e redirecionam;
- refetch ao foco funciona como fallback.

---

## 10. Requisitos funcionais

### 10.1 Fundação

| ID | Requisito | Prioridade |
|---|---|---|
| FE-FND-001 | Next.js App Router com TypeScript estrito | Must |
| FE-FND-002 | BFF same-origin obrigatório | Must |
| FE-FND-003 | Adapter tipado e Zod runtime | Must |
| FE-FND-004 | Nenhum componente consome Medusa diretamente | Must |
| FE-FND-005 | Correlation ID sanitizado | Must |
| FE-FND-006 | Configuração pública separada de secrets | Must |
| FE-FND-007 | OpenAPI é gate para qualquer rota upstream | Must |

### 10.2 Catálogo

| ID | Requisito | Prioridade |
|---|---|---|
| FE-CAT-001 | Listar produtos vendáveis | Must |
| FE-CAT-002 | Exibir produto e variantes públicas | Must |
| FE-CAT-003 | Não expor metadata interna | Must |
| FE-CAT-004 | Cache/revalidação por tags | Must |
| FE-CAT-005 | Tratar indisponibilidade sem vazar motivo interno | Must |

### 10.3 Carrinho

| ID | Requisito | Prioridade |
|---|---|---|
| FE-CART-001 | Criar carrinho lazy | Must |
| FE-CART-002 | Proteger carrinho por capability | Must |
| FE-CART-003 | Adicionar, atualizar, remover e esvaziar | Must |
| FE-CART-004 | Quantidade entre 1 e 99 | Must |
| FE-CART-005 | Sincronizar abas | Must |
| FE-CART-006 | Merge transacional e parcial | Must |
| FE-CART-007 | Bloquear checkout em `requiresReview` | Must |
| FE-CART-008 | Resolver conflitos por ETag | Must |

### 10.4 Autenticação

| ID | Requisito | Prioridade |
|---|---|---|
| FE-AUTH-001 | Cadastro em duas etapas | Must |
| FE-AUTH-002 | Login e logout BFF | Must |
| FE-AUTH-003 | Reset de senha | Must |
| FE-AUTH-004 | Verificação flexível | Must |
| FE-AUTH-005 | Renovação somente com JWT válido | Must |
| FE-AUTH-006 | Revogação após alteração de credenciais | Must |
| FE-AUTH-007 | Sessão absoluta máxima de 30 dias | Must |

### 10.5 Checkout e frete

| ID | Requisito | Prioridade |
|---|---|---|
| FE-CHK-001 | Checkout exclusivamente autenticado | Must |
| FE-CHK-002 | Rascunho parcial e validação final separada | Must |
| FE-CHK-003 | Endereço BR estruturado | Must |
| FE-CHK-004 | CPF protegido e mascarado | Must |
| FE-CHK-005 | CEP via BFF com fallback | Must |
| FE-CHK-006 | Consentimentos versionados | Must |
| FE-SHP-001 | Cotação automática | Must |
| FE-SHP-002 | Seleção autoritativa | Must |
| FE-SHP-003 | Revogação por mudança | Must |
| FE-SHP-004 | Sem fallback no Milestone 1 | Must |

### 10.6 Pagamento e confirmação

| ID | Requisito | Prioridade |
|---|---|---|
| FE-PAY-001 | Stripe Payment Element | Must |
| FE-PAY-002 | `client_secret` somente em memória | Must |
| FE-PAY-003 | 3DS e return URL segura | Must |
| FE-PAY-004 | Idempotência e tentativa compatível | Must |
| FE-PAY-005 | Consultar antes de retry após erro incerto | Must |
| FE-PAY-006 | Invalidar em mudança estrutural | Must |
| FE-CONF-001 | Trocar token no servidor | Must |
| FE-CONF-002 | Polling com backoff e rate limit | Must |
| FE-CONF-003 | Não confirmar pedido pelo browser | Must |
| FE-CONF-004 | Refresh e múltiplas abas | Must |
| FE-CONF-005 | Reconciliação controlada | Must |
| FE-CONF-006 | Resumo de Order reduzido | Must |

### 10.7 Conteúdo

| ID | Requisito | Prioridade |
|---|---|---|
| FE-CNT-001 | Política de Privacidade | Must |
| FE-CNT-002 | Termos de Compra | Must |
| FE-CNT-003 | Política de Trocas | Must |
| FE-CNT-004 | Canal de suporte | Must |
| FE-CNT-005 | Revisão jurídica antes do go-live | Must |

---

## 11. Estados de interface e erros

### 11.1 Estados comuns

- `idle`;
- `loading`;
- `success`;
- `empty`;
- `validation_error`;
- `unauthorized`;
- `forbidden`;
- `not_found`;
- `conflict`;
- `rate_limited`;
- `server_error`;
- `offline`;
- `retrying`.

### 11.2 Envelope

```ts
type BffErrorDTO = {
  code: string
  message: string
  correlationId?: string
  retryable: boolean
  fieldErrors?: Record<string, string>
  cart?: CartDTO
}
```

### 11.3 Códigos principais

Carrinho:

- `CART_NOT_FOUND`;
- `CART_ACCESS_DENIED`;
- `CART_VERSION_MISMATCH`;
- `CART_REVIEW_REQUIRED`;
- `VARIANT_NOT_SELLABLE`;
- `INVALID_QUANTITY`;
- `QUANTITY_LIMIT_EXCEEDED`.

Checkout:

- `INVALID_CPF`;
- `FEDERAL_TAX_ID_REQUIRED`;
- `ZERO_TOTAL_NOT_SUPPORTED`.

Frete:

- `SHIPPING_ADDRESS_INVALID`;
- `SHIPPING_NOT_AVAILABLE`;
- `SHIPPING_QUOTE_EXPIRED`;
- `SHIPPING_OPTION_NO_LONGER_ELIGIBLE`;
- `SHIPPING_PROVIDER_UNAVAILABLE`;
- `SHIPPING_PROVIDER_TIMEOUT`.

Pagamento:

- `PAYMENT_CHECKOUT_INCOMPLETE`;
- `PAYMENT_ATTEMPT_ALREADY_ACTIVE`;
- `PAYMENT_ATTEMPT_INVALIDATED`;
- `PAYMENT_PROVIDER_UNAVAILABLE`;
- `PAYMENT_CARD_DECLINED`;
- `PAYMENT_CONFIRMATION_UNKNOWN`;
- `PAYMENT_IN_PROGRESS`.

Confirmação:

- `CONFIRMATION_NOT_FOUND`;
- `CONFIRMATION_RATE_LIMITED`;
- `CONFIRMATION_SERVICE_UNAVAILABLE`.

---

## 12. Dinheiro e formatação

Upstream:

```ts
type StoreMajorMoney = {
  amount: number
  currency_code: "brl"
  unit: "major"
}

type StoreMinorMoney = {
  amount: number
  currency_code: "brl"
  unit: "minor"
}
```

DTO interno:

```ts
type MoneyDTO = {
  amountMinor: number
  currency: "BRL"
}
```

Regras:

- catálogo/carrinho major → conversão decimal segura;
- pagamento minor → passagem validada;
- componentes recebem apenas `MoneyDTO`;
- totais vêm do backend;
- valores negativos são rejeitados;
- zero no frete é suportado tecnicamente;
- total final zero é bloqueado;
- usar `Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })`;
- nunca usar ponto flutuante para totais autoritativos.

---

## 13. Autenticação e sessão

### 13.1 Cookies

| Cookie | Uso |
|---|---|
| `indicio_session_jwt` | sessão autenticada |
| `indicio_cart_id` | envelope do carrinho convidado |
| `indicio_confirmation_session` | confirmação assíncrona |

Todos:

- `HttpOnly`;
- `SameSite=Lax`;
- `Secure` em staging/produção;
- host-only;
- sem acesso pelo JavaScript.

### 13.2 Segurança

- backend é autoridade para JWT e política de conta;
- BFF aplica defesa em profundidade;
- JWT não vai para localStorage;
- `connect.sid` não será usado pela storefront;
- publishable key do Medusa permanece no BFF;
- Stripe publishable key pode estar no browser;
- secrets nunca entram no bundle.

### 13.3 Sessão expirada durante checkout

```text
→ desmontar Elements
→ invalidar/consultar tentativa
→ preservar carrinho
→ redirecionar para login com returnUrl
→ reautenticar
→ revalidar checkout, frete e termos
```

---

## 14. Analytics e observabilidade

### 14.1 Eventos frontend

| Evento | Obrigatoriedade |
|---|---|
| `product_viewed` | optional |
| `variant_selected` | optional |
| `add_to_cart` | must |
| `cart_expired` | must |
| `cart_conflict` | must |
| `shipping_options_viewed` | must |
| `shipping_selected` | must |
| `shipping_quote_failed` | must |
| `payment_client_confirmed` | must |
| `payment_client_failed` | must |
| `checkout_failed` | must |
| `payment_confirmation_processing` | must |
| `payment_confirmation_delayed` | must |
| `payment_confirmation_failed` | must |
| `reconciliation_message_viewed` | must |
| `order_confirmation_viewed` | must |

### 14.2 Campos proibidos

- CPF;
- e-mail;
- CEP;
- cart ID;
- Customer ID;
- PaymentIntent ID;
- paymentAttemptRef;
- `client_secret`;
- confirmation token;
- `guestCartToken`;
- `orderReference`;
- endereço completo.

### 14.3 Receita

`purchase_completed`:

- emitido exclusivamente pelo backend;
- somente após criação do `Order`;
- não é emitido pela página de confirmação;
- falha do PostHog não bloqueia `Order`.

### 14.4 Sentry

- remover query strings sensíveis;
- remover cookies e headers;
- não enviar bodies completos;
- usar correlation ID;
- não usar `orderReference` como tag;
- mascarar URLs;
- separar local, preview e produção.

---

## 15. Segurança, privacidade e retenção

- HTTPS obrigatório;
- `Origin` e `Host` validados em mutações BFF;
- sem mutações por `GET`;
- JSON allowlist;
- body size limitado;
- rate limit por IP/sessão;
- CSP segmentada;
- URLs sanitizadas;
- `Referrer-Policy` restritiva;
- tokens removidos antes de scripts terceiros;
- capabilities marcadas `x-sensitive: true`;
- dados pessoais minimizados.

Retenção proposta, sujeita a jurídico:

- prova dos Termos de Compra: 5 anos;
- prova de ciência da Política de Privacidade: 5 anos;
- registros de acesso: IP/data/hora por no mínimo 6 meses;
- user agent: não armazenado;
- CPF em carrinho abandonado: 7 dias;
- consentimentos separados de registros de acesso.

---

## 16. Acessibilidade, desempenho e SEO

### 16.1 Acessibilidade

- WCAG 2.2 AA;
- teclado completo;
- foco visível;
- labels e descrições de erro;
- `aria-live` para mudanças de carrinho/pagamento;
- modais com foco gerenciado;
- mensagens não dependem somente de cor;
- imagens com alt editorial.

### 16.2 Desempenho

Metas:

- LCP ≤ 2,5 s p75;
- INP ≤ 200 ms;
- CLS ≤ 0,1;
- imagens responsivas;
- Stripe carregado somente no pagamento;
- analytics tardio;
- checkout e carrinho sem cache compartilhado.

### 16.3 SEO

- metadata por produto;
- canonical;
- sitemap e robots;
- Open Graph;
- JSON-LD somente com dados públicos;
- checkout, conta, confirmação e autenticação com `noindex`;
- URLs de produto definidas pelo contrato de catálogo.

---

## 17. Estratégia de integração e contratos

### 17.1 Fonte de verdade

1. Store OpenAPI: BFF → Medusa.
2. TypeScript/Zod internos: browser → BFF.
3. PRD Backend/SRS: regras de negócio.
4. PRD Frontend: UI e BFF.
5. Matriz de rastreabilidade: estado por requisito.

### 17.2 Versionamento

- OpenAPI atual: `1.0.0-draft.1`;
- primeiro contrato executável: `1.1.0`;
- tag Git: `v1.1.0`;
- breaking monetário/auth: `2.0.0`;
- depreciação: uma release coordenada ou 30 dias, prevalecendo o maior.

### 17.3 Geração e validação

```text
OpenAPI
→ openapi-typescript
→ tipos versionados
→ Zod manual
→ adapters
→ DTOs
```

Bloqueia PR:

- drift de tipos;
- operação sem Zod;
- divergência fixture/OpenAPI/Zod;
- schema alterado sem contract test.

### 17.4 Cache

| Recurso | Política |
|---|---|
| catálogo/produto | ISR + tags |
| BFF de cotação | read-through ≤ 5 min |
| carrinho | `no-store` |
| sessão/conta | `no-store` |
| checkout/pagamento | `no-store` |
| confirmação | `no-store` |
| legais | estático |

---

## 18. Testes

### 18.1 Unitários

- conversão major/minor;
- adapters;
- Zod;
- sessão;
- cookie envelopes;
- seleção de variante;
- mutações otimistas;
- merge;
- CPF;
- CEP fallback/cache;
- ETag;
- frete;
- estados Stripe;
- polling;
- redaction;
- ausência de `purchase_completed`.

### 18.2 Integração

- cadastro em duas etapas;
- verificação flexível;
- reset;
- carrinho guest capability;
- merge completo/parcial;
- checkout draft/final;
- frete disponível/indisponível;
- PaymentAttempt;
- 3DS;
- recusa;
- erro incerto;
- reconciliação;
- pedido confirmado;
- múltiplas abas.

### 18.3 Contract tests

Validar:

- status HTTP;
- requests/responses;
- security schemes;
- headers;
- idempotência;
- ETag;
- unidade monetária;
- masking;
- códigos de erro;
- ausência de campos proibidos;
- equivalência OpenAPI/Zod.

### 18.4 E2E

```text
Home
→ catálogo
→ produto
→ carrinho convidado
→ cadastro/login
→ merge
→ checkout
→ frete
→ Payment Element
→ 3DS quando aplicável
→ processamento
→ ORDER_CONFIRMED
→ limpeza do carrinho
```

Cenários obrigatórios:

- conflito de carrinho;
- merge parcial;
- CPF inválido;
- CEP indisponível;
- cotação expirada;
- provider indisponível;
- cartão recusado;
- erro de rede após confirmação;
- refresh;
- múltiplas abas;
- reconciliação.

---

## 19. Ordem de implementação

### Etapa 0 — Materialização contratual

1. atualizar PRD Frontend;
2. atualizar PRD Backend;
3. atualizar SRS;
4. preencher matriz de rastreabilidade;
5. atualizar registry;
6. gerar Store OpenAPI;
7. gerar Webhooks OpenAPI;
8. criar tipos e Zod;
9. criar fixtures/mocks;
10. criar contract tests e CI de drift.

### Etapa 1 — Fundação e catálogo

- repositório Next.js independente;
- App Router;
- design system;
- BFF;
- adapter;
- observabilidade;
- home;
- catálogo;
- produto.

### Etapa 2 — Carrinho

- cookies;
- capability;
- mini-carrinho;
- mutações;
- merge;
- sync entre abas.

### Etapa 3 — Autenticação

- cadastro;
- login/logout;
- verificação;
- reset;
- proteção de rotas.

### Etapa 4 — Checkout

- draft;
- validação;
- CPF;
- CEP;
- consentimentos.

### Etapa 5 — Frete

- cotação;
- seleção;
- expiração;
- recotação.

### Etapa 6 — Pagamento

- Payment Element;
- PaymentAttempt;
- 3DS;
- falhas;
- invalidação.

### Etapa 7 — Confirmação

- troca de token;
- polling;
- reconciliação;
- página confirmada;
- limpeza.

Cada etapa permanece sujeita a autorização humana.

---

## 20. Critérios de aceite

O Milestone 1 será aceito quando:

- Store OpenAPI executável cobrir todas as operações MUST;
- BFF for o único consumidor do Medusa pela storefront;
- contratos upstream forem validados em runtime;
- catálogo e produto exibirem somente dados públicos;
- carrinho convidado usar capability;
- mutações forem idempotentes;
- merge completo e parcial funcionarem;
- checkout exigir autenticação;
- verificação flexível funcionar;
- CPF estiver protegido;
- frete for autoritativo e revogável;
- Stripe Payment Element e 3DS funcionarem;
- `client_secret` permanecer efêmero;
- erro incerto consultar status antes de retry;
- `Order` depender de webhook;
- confirmação sobreviver a refresh;
- múltiplas abas não criarem cobrança;
- `purchase_completed` permanecer no backend;
- analytics e Sentry estiverem sanitizados;
- revisão jurídica estiver concluída;
- unit, integration, contract e E2E passarem;
- preview e produção tiverem domínios, cookies, CSP e CORS validados.

---

## 21. Pendências de materialização

As decisões estão fechadas, mas os seguintes artefatos permanecem pendentes:

- `docs/PRD_Backend_v1.1.md`;
- `docs/SRS_v1.5.md`;
- `docs/FRONTEND_CONTRACT_TRACEABILITY.md`;
- registry TypeScript da Store OpenAPI;
- `apps/backend/src/api-docs/generated/store.openapi.json`;
- Webhooks OpenAPI;
- ADR de BFF;
- ADR de autenticação/sessão;
- ADR de merge de carrinhos;
- ADR de dinheiro;
- ADR de confirmação assíncrona;
- ADR de CPF/retenção;
- tipos gerados;
- schemas Zod;
- fixtures;
- mock server;
- contract tests;
- CI de drift.

Estado:

```text
Gate de Decisões A–J: PASS
Gate de Decisões R: PASS
Gate de Artefatos: PENDING
Etapa 0: DECISIONS COMPLETE, ARTIFACTS PENDING
PASS DOCUMENTAL: ainda não concedido
PASS PARA MOCK DEVELOPMENT: ainda não concedido
PASS PARA INTEGRAÇÃO: ainda não concedido
```

---

## 22. Referências

- `docs/PRD_Backend_v1.1.md`;
- `docs/SRS_v1.5.md`;
- `docs/DB_MODEL_v1.21.md`;
- `docs/openapi/README.md`;
- `apps/backend/src/api-docs/generated/store.openapi.json`;
- `apps/backend/src/api-docs/operations/store/`;
- `apps/backend/src/api-docs/components/security-schemes.ts`;
- `docs/FRONTEND_CONTRACT_TRACEABILITY.md` — pendente;
- `.planning/PROJECT.md`;
- `.planning/STATE.md`;
- `ops/API_DOCS.md`.

---

*Última revisão: 2026-08-05 — decisões dos Blocos A–J e R incorporadas. O documento distingue contratos-alvo aprovados de artefatos ainda pendentes e não autoriza o consumo de operações antes de sua materialização no OpenAPI.*
