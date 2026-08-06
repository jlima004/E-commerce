# PRD — Backend E-commerce POD da Indicio Cult

| Campo | Valor |
|---|---|
| Documento | Product Requirements Document — Backend |
| Projeto | E-commerce headless Print-on-Demand da Indicio Cult |
| Versão | 1.1.1 — requisitos do Frontend Milestone 1 |
| Data da revisão | 2026-08-06 |
| Status | Canônico de requisitos — backend v1.0 entregue; extensão Storefront M1 aprovada e pendente de materialização |
| Responsável | Jefferson |
| Mercado inicial | Brasil |
| Moeda | BRL |
| Runtime atual | Heroku (`release`, `web` e `worker`) |
| Persistência | Supabase PostgreSQL |
| Cache e processamento assíncrono | Redis |
| Integrações | Stripe, Resend, Gelato, PostHog, Sentry e Supabase Storage |
| Consumidor público | BFF same-origin do frontend Next.js |
| Contratos de API | OpenAPI 3.1.2 — Store, Admin e Webhooks |
| Base de alinhamento | PRD Frontend v1.1.2 · SRS v1.5 · DB Model v1.21 · decisões dos Blocos A–J e R |

> **Autoridade e estado:** este documento combina dois estados distintos. O backend `v1.0` descrito como **Entregue** corresponde ao sistema já implementado. Os requisitos marcados como **Aprovado — pendente** formam o contrato-alvo necessário ao Frontend Milestone 1 e não podem ser tratados como implementados antes de código, OpenAPI, schemas, fixtures e testes existirem.

> **Gate vigente:** `DECISIONS COMPLETE, ARTIFACTS PENDING`. A atualização deste PRD fecha a especificação do backend para o frontend, mas não concede `PASS DOCUMENTAL`, `PASS PARA MOCK DEVELOPMENT` nem `PASS PARA INTEGRAÇÃO`.

> **Regra central:** a storefront nunca cria, confirma ou infere um `Order`. Um `Order` só existe após confirmação canônica, validada e idempotente do pagamento pelo webhook da Stripe.

---

## Sumário

1. [Resumo executivo](#1-resumo-executivo)
2. [Objetivos e métricas](#2-objetivos-e-métricas)
3. [Estado e escopo](#3-estado-e-escopo)
4. [Usuários, consumidores e limites](#4-usuários-consumidores-e-limites)
5. [Arquitetura atual e arquitetura-alvo](#5-arquitetura-atual-e-arquitetura-alvo)
6. [Contratos e versionamento](#6-contratos-e-versionamento)
7. [Contrato-alvo para o Frontend Milestone 1](#7-contrato-alvo-para-o-frontend-milestone-1)
8. [Fluxos funcionais](#8-fluxos-funcionais)
9. [Requisitos funcionais consolidados](#9-requisitos-funcionais-consolidados)
10. [Dados, dinheiro e concorrência](#10-dados-dinheiro-e-concorrência)
11. [Segurança, privacidade e retenção](#11-segurança-privacidade-e-retenção)
12. [Erros e semântica HTTP](#12-erros-e-semântica-http)
13. [Observabilidade e eventos](#13-observabilidade-e-eventos)
14. [Integrações externas](#14-integrações-externas)
15. [Testes e artefatos obrigatórios](#15-testes-e-artefatos-obrigatórios)
16. [Deploy e operação](#16-deploy-e-operação)
17. [Critérios de aceite](#17-critérios-de-aceite)
18. [Rastreabilidade com o frontend](#18-rastreabilidade-com-o-frontend)
19. [Pendências e gates](#19-pendências-e-gates)
20. [Referências canônicas](#20-referências-canônicas)

---

## 1. Resumo executivo

O backend da Indicio Cult é a autoridade transacional e operacional do e-commerce Print-on-Demand. Ele concentra catálogo, carrinho, identidade de cliente, checkout, frete, pagamento, criação de pedidos, fulfillment, tracking, reembolsos, trocas, auditoria e observabilidade.

O backend `v1.0` já protege a cadeia financeira e operacional:

```text
Pagamento confirmado por webhook canônico
→ coordenação idempotente e concorrente
→ criação de um único Order
→ persistência das outboxes locais
→ efeitos externos reprocessáveis
→ dispatch Gelato somente quando elegível
```

O Frontend Milestone 1 exige ampliar a Store API para suportar uma storefront Next.js com BFF same-origin. O navegador não chamará o Medusa diretamente. O BFF será o único consumidor público e deverá receber contratos suficientes para:

- catálogo e produto;
- carrinho convidado protegido por capability;
- mutações concorrentes com `ETag`;
- cadastro, login, reset e verificação flexível de e-mail;
- merge transacional de carrinhos;
- checkout brasileiro autenticado;
- CPF protegido e consentimentos versionados;
- cotação e seleção autoritativa de frete;
- pagamento por cartão via Stripe Payment Element;
- invalidação e consulta segura de tentativas;
- confirmação assíncrona por sessão opaca;
- resumo reduzido do pedido confirmado;
- revalidação assinada do catálogo;
- erros estáveis, idempotência e rastreabilidade.

A extensão não modifica os invariantes financeiros do backend `v1.0`. Ela materializa interfaces seguras para o frontend utilizar esses invariantes.

---

## 2. Objetivos e métricas

### 2.1 Objetivos

1. Expor todas as operações necessárias ao Frontend Milestone 1 em contrato OpenAPI executável.
2. Manter o BFF como único consumidor da Store API pela storefront.
3. Impedir acesso indevido a carrinhos convidados por meio de capability opaca.
4. Permitir mutações idempotentes e concorrentes sem sobrescrita silenciosa.
5. Exigir autenticação antes de endereço, frete e pagamento.
6. Preservar a política flexível de verificação de e-mail aprovada.
7. Armazenar CPF com proteção de campo e retornar somente valor mascarado.
8. Tornar frete, totais, elegibilidade e versões autoritativos no backend.
9. Entregar apenas o `client_secret` necessário ao Stripe.js e manter tokens auxiliares restritos ao BFF.
10. Suportar refresh, 3DS, múltiplas abas e erros incertos sem cobrança duplicada.
11. Expor confirmação de pedido somente após `Order` real.
12. Emitir `purchase_completed` exclusivamente pelo backend.
13. Manter OpenAPI, Zod, fixtures, mocks e contract tests sem drift.

### 2.2 Métricas de sucesso

- zero `Order` criado antes do webhook Stripe canônico;
- zero cobrança iniciada com versão, frete ou total incompatível;
- zero mutação destrutiva aplicada sobre `ETag` desatualizado;
- zero `guestCartToken`, `confirmationToken`, `confirmationSessionRef`, `client_secret`, JWT ou CPF em logs, URLs ou analytics;
- 100% das operações BFF → backend presentes no OpenAPI aprovado;
- 100% das respostas críticas validadas por schema executável;
- 100% das mutações repetíveis protegidas por `Idempotency-Key`;
- 100% dos erros de contrato com código estável e `correlationId` sanitizado;
- confirmação assíncrona recuperável após refresh e mudança de aba;
- ausência de drift entre registry, OpenAPI gerado, Zod, fixtures e contract tests.

---

## 3. Estado e escopo

### 3.1 Legenda de estado

| Estado | Significado |
|---|---|
| Entregue | Implementado no backend v1.0 e coberto pelos gates aceitos |
| Aprovado — pendente | Decisão fechada para o Frontend M1, ainda sem todos os artefatos executáveis |
| Implementado, ativação diferida | Código existente, mas dependente de habilitação externa |
| Posterior | Fora do Frontend Milestone 1 |
| Fora do escopo | Não pertence ao produto atual |

### 3.2 Backend v1.0 entregue

- Medusa v2 com Node.js e TypeScript;
- catálogo, variantes, preços em BRL e metadados Gelato;
- imagens públicas por Supabase Storage;
- carrinho convidado e autenticado;
- associação segura de carrinho;
- checkout brasileiro base;
- `PaymentAttempt` para cartão e Pix;
- webhook Stripe com raw body, assinatura e idempotência;
- criação pós-webhook de um único `Order`;
- outboxes de analytics e e-mail;
- fulfillment e webhook Gelato;
- tracking público por token;
- reembolsos, trocas, alertas e auditoria;
- health checks, Sentry, logs estruturados;
- OpenAPI Store, Admin e Webhooks;
- processos Heroku `release`, `web` e `worker`.

### 3.3 Extensão obrigatória para o Frontend Milestone 1

| Área | Entrega-alvo |
|---|---|
| Autenticação | cadastro, login guardado, refresh, reset e verificação flexível |
| Carrinho convidado | capability opaca, hash persistido, rotação/revogação e criação idempotente |
| Carrinho | adicionar, atualizar, remover, esvaziar, merge e revisão |
| Concorrência | `ETag`, `If-Match`, versão canônica e erro `412` |
| Checkout | draft parcial, validação final, endereço BR, CPF e consentimentos |
| Frete | cotação, expiração, seleção opaca e invalidação por mudança |
| Pagamento | criação compatível, status e invalidação |
| Confirmação | token BFF-only, troca atômica, sessão opaca e polling |
| Pedido | resumo reduzido e autorizado por referência não sequencial |
| Catálogo | contrato público estável e evento assinado de revalidação |
| Plataforma | erros fechados, rate limit, correlation ID e idempotência |
| Contratos | OpenAPI 1.1.0, schemas, fixtures, mocks e contract tests |

### 3.4 Fora do Frontend Milestone 1

- checkout convidado;
- Pix na storefront;
- histórico completo de pedidos;
- endereços salvos;
- cupons, gift cards e promoções;
- pedidos de total zero;
- solicitação automatizada de troca;
- tracking público na storefront;
- conta empresarial e CNPJ;
- múltiplas moedas ou países;
- fallback logístico;
- upload de arte e personalização;
- reviews, chat e afiliados.

Pix permanece implementado no backend com ativação operacional diferida.

---

## 4. Usuários, consumidores e limites

| Ator/consumidor | Permissão |
|---|---|
| Visitante | catálogo e carrinho convidado |
| Cliente em cadastro | identidade, criação do Customer e sessão inicial |
| Cliente autenticado | merge, checkout, frete, pagamento e confirmação |
| BFF Next.js | único consumidor storefront → Medusa; guarda credenciais e capabilities |
| Navegador | chama somente o BFF; nunca recebe JWT, guest capability ou referências internas |
| Operador Admin | fluxos administrativos existentes |
| Stripe | processamento e webhooks financeiros |
| Worker | jobs, retries, relays, scanners e reconciliação |

### 4.1 Limite BFF

O backend DEVE assumir que o BFF:

- mantém `x-publishable-api-key` server-side;
- envia `Authorization` com JWT de Customer;
- mantém `x-indicio-guest-cart-token` em cookie `HttpOnly`;
- cria `Idempotency-Key`;
- propaga `If-Match`;
- cria e propaga `x-correlation-id`;
- valida a resposta upstream;
- converte contratos em DTOs browser-facing.

O backend NÃO DEVE depender de segredo armazenado no navegador para proteger carrinho, confirmação ou identidade.

### 4.2 Operações fora do Store OpenAPI

- logout do dispositivo atual é operação do BFF que remove cookies locais;
- busca de CEP via ViaCEP/BrasilAPI é responsabilidade do BFF;
- eventos de analytics de interface pertencem ao frontend;
- `purchase_completed` pertence exclusivamente ao backend.

---

## 5. Arquitetura atual e arquitetura-alvo

### 5.1 Topologia-alvo

```text
Navegador
  │ same-origin
  ▼
Next.js BFF — www.indiciocult.com.br
  ├── cookies HttpOnly
  ├── publishable key
  ├── Customer JWT
  ├── guest cart capability
  ├── confirmation session envelope
  ├── Zod + adapters
  └── correlation/idempotency
  │ HTTPS
  ▼
Heroku web.1 — Medusa
  ├── /auth
  ├── Store API
  ├── Admin API
  ├── webhooks Stripe/Gelato
  ├── OpenAPI/Swagger
  ├── health
  ├── Supabase PostgreSQL
  ├── Redis
  ├── Supabase Storage
  └── Sentry

Heroku worker.1
  ├── PostHog relay
  ├── Resend relay
  ├── Gelato dispatch/reconciliation
  ├── scanners
  └── outbound catalog revalidation

Heroku release
  └── db:migrate:safe
```

### 5.2 Evento de revalidação do catálogo

Quando produto, variante, preço, disponibilidade, publicação ou mídia pública relevante mudar, o backend DEVE poder emitir evento assinado para:

```text
POST https://www.indiciocult.com.br/api/webhooks/medusa/catalog-revalidation
```

Headers:

- `x-indicio-event-id`;
- `x-indicio-event-type`;
- `x-indicio-signature`;
- `x-indicio-timestamp`.

O evento DEVE:

- ser idempotente por `event-id`;
- usar assinatura HMAC e tolerância de timestamp documentada;
- não incluir metadata Gelato ou dados privados;
- identificar tags `catalog` e/ou `product:<id>`;
- ser reprocessável pelo worker;
- registrar falha persistente sem bloquear mutações administrativas.

---

## 6. Contratos e versionamento

### 6.1 Documentos

| Superfície | Artefato |
|---|---|
| Store | `apps/backend/src/api-docs/generated/store.openapi.json` |
| Admin | `apps/backend/src/api-docs/generated/admin.openapi.json` |
| Webhooks | `apps/backend/src/api-docs/generated/webhooks.openapi.json` |

O registry TypeScript em `apps/backend/src/api-docs/` é a fonte de geração. JSON gerado não deve ser editado manualmente.

### 6.2 Estado atual da Store API

O contrato atual contém dez operações as-built:

| operationId atual | Rota |
|---|---|
| `storeHealthGetLive` | `GET /health/live` |
| `storeHealthGetReady` | `GET /health/ready` |
| `storeProductsList` | `GET /store/products` |
| `storeProductsRetrieve` | `GET /store/products/{id}` |
| `storeCartGetActive` | `GET /store/carts/active` |
| `storeCartCreateOrGetActive` | `POST /store/carts/active` |
| `storeCustomerCartAttach` | `POST /store/customers/me/cart/attach` |
| `storePaymentAttemptCreateCard` | `POST /store/carts/{id}/payment-attempts/card` |
| `storePaymentAttemptCreatePix` | `POST /store/carts/{id}/payment-attempts/pix` |
| `storeTrackingLookup` | `POST /store/tracking/lookup` |

`storeCustomerCartAttach` será deprecated para a nova storefront. Pix e tracking público ficam fora do Frontend M1.

### 6.3 Versão-alvo

- primeiro contrato executável para o Frontend M1: `1.1.0`;
- tag coordenada prevista: `v1.1.0`;
- breaking change de auth ou dinheiro: `2.0.0`;
- depreciação: ao menos uma release coordenada ou 30 dias, prevalecendo o maior prazo.

### 6.4 Regra de consumo

Uma operação só pode ser consumida pelo frontend quando:

1. existir no registry;
2. existir no JSON OpenAPI gerado;
3. possuir schemas e exemplos seguros;
4. possuir teste de contrato;
5. possuir Zod/fixture correspondente;
6. passar os gates de drift.

---

## 7. Contrato-alvo para o Frontend Milestone 1

### 7.1 Autenticação e Customer

| operationId | Método | Rota | Estado |
|---|---|---|---|
| `registerCustomerIdentity` | POST | `/auth/customer/emailpass/register` | Aprovado — pendente de contrato |
| `createCustomer` | POST | `/store/customers` | Aprovado — pendente de contrato |
| `customerLogin` | POST | `/auth/customer/emailpass` | Aprovado — guard adicional |
| `getCustomerMe` | GET | `/store/customers/me` | Aprovado — pendente de contrato |
| `requestPasswordReset` | POST | `/auth/customer/emailpass/reset-password` | Aprovado — Medusa 2.16+ |
| `resetPassword` | POST | `/auth/customer/emailpass/update` | Aprovado — pendente de contrato |
| `refreshCustomerToken` | POST | `/auth/token/refresh` | Aprovado — guard adicional |
| `requestEmailVerification` | POST | `/store/customers/me/verify` | Aprovado — customizado |
| `resendEmailVerification` | POST | `/store/customers/me/verify/resend` | Aprovado — customizado |
| `confirmEmailVerification` | POST | `/store/customers/verify` | Aprovado — customizado |
| `getEmailVerificationStatus` | GET | `/store/customers/me/verify/status` | Aprovado — customizado |

Regras:

- cadastro ocorre em duas etapas: identidade → registration JWT → Customer;
- sessão inicial pode concluir compra mesmo com e-mail ainda não verificado;
- novo login após logout ou expiração completa exige e-mail verificado;
- falha no envio do e-mail não bloqueia compra da sessão inicial;
- refresh exige JWT válido e não revogado;
- alteração de senha revoga tokens anteriores;
- respostas de auth não expõem se um e-mail inexistente está cadastrado;
- endpoints de verificação e reset possuem rate limit e resposta anti-enumeração;
- JWT nunca é retornado em exemplos de contrato com valor reutilizável;
- logout não é endpoint do backend para o M1; o BFF elimina a sessão local.

### 7.2 Carrinho convidado e capability

| operationId | Método | Rota |
|---|---|---|
| `getActiveStoreCart` | GET | `/store/carts/active` |
| `createActiveStoreCart` | POST | `/store/carts/active` |

Na criação de carrinho convidado:

```http
201 Created
ETag: "<cart-version>"
x-indicio-guest-cart-token: "<opaque-capability>"
```

Requisitos:

- token gerado com no mínimo 32 bytes CSPRNG;
- persistência somente do SHA-256;
- header marcado como sensível no contrato;
- token vinculado ao carrinho e ao contexto permitido;
- mesma `Idempotency-Key` retorna o mesmo contexto ainda válido;
- token nunca aparece em body, URL, query, logs, traces ou analytics;
- capability inválida retorna erro não enumerável;
- merge bem-sucedido consome e revoga a capability;
- carrinho expirado ou completado revoga o acesso convidado.

### 7.3 Mutações do carrinho

| operationId | Método | Rota |
|---|---|---|
| `addCartLineItem` | POST | `/store/carts/{id}/line-items` |
| `updateCartLineItem` | POST | `/store/carts/{id}/line-items/{item_id}` |
| `removeCartLineItem` | DELETE | `/store/carts/{id}/line-items/{item_id}` |
| `clearCartLineItems` | DELETE | `/store/carts/{id}/line-items` |
| `mergeCustomerCart` | POST | `/store/customers/me/cart/merge` |
| `acknowledgeCartReview` | POST | `/store/carts/{id}/review/acknowledge` |

Regras:

- quantidade inteira de 1 a 99;
- quantidade zero na atualização equivale à remoção;
- backend deriva produto, preço, moeda e elegibilidade a partir da variante;
- cart ID, preço ou metadata enviados no body além do schema são rejeitados;
- todas as respostas retornam carrinho canônico e novo `ETag`;
- mutações exigem `If-Match` quando o carrinho já possui versão;
- mismatch retorna `412 CART_VERSION_MISMATCH` com carrinho canônico opcional;
- não há repetição automática de mutação destrutiva;
- alteração de itens revoga cotação, seleção de frete e tentativa de pagamento incompatíveis.

### 7.4 Merge transacional

`mergeCustomerCart` DEVE:

- exigir Customer JWT e guest capability válida;
- executar em transação;
- somar quantidades iguais até o limite de 99;
- rejeitar itens individualmente quando não vendáveis;
- preservar carrinho autenticado válido quando aplicável;
- consumir a capability apenas no resultado comprometido;
- retornar um dos outcomes:
  - `MERGED`;
  - `MERGED_PARTIAL`;
  - `GUEST_CART_ATTACHED`;
  - `CUSTOMER_CART_PRESERVED`;
  - `NO_ITEMS`;
- retornar `rejectedItems`;
- definir `requiresReview=true` quando a intervenção do usuário for necessária;
- impedir checkout enquanto a revisão não for reconhecida;
- tornar `acknowledgeCartReview` persistente, idempotente e versionado.

`POST /store/customers/me/cart/attach` permanece suportado apenas durante a janela de depreciação.

### 7.5 Checkout brasileiro

| operationId | Método | Rota |
|---|---|---|
| `patchCartCheckoutDetails` | PATCH | `/store/carts/{id}/checkout-details` |
| `validateCartCheckoutDetails` | POST | `/store/carts/{id}/checkout-details/validate` |

Pré-condições:

- Customer autenticado;
- carrinho associado, não vazio e vendável;
- `requiresReview=false`;
- versão atual;
- nenhuma tentativa incompatível em estado bloqueante.

Draft:

- persiste somente campos presentes e válidos;
- não persiste CPF inválido;
- recalcula `checkout_data_complete`;
- retorna todos os campos públicos sanitizados e novo `ETag`.

Validação final:

- valida a etapa completa de forma atômica;
- não aplica persistência parcial em caso de erro;
- retorna todos os `fieldErrors`;
- libera cotação de frete e pagamento apenas após sucesso.

Campos de pessoa física no Brasil:

- nome;
- sobrenome;
- e-mail da conta read-only;
- telefone;
- CPF;
- CEP;
- rua;
- número ou `S/N`;
- bairro;
- cidade;
- UF;
- país fixo `BR`;
- complemento opcional.

O backend mantém endereço estruturado no domínio e realiza o mapeamento necessário para os modelos Medusa/providers.

### 7.6 CPF e consentimentos

CPF:

- validado no backend;
- persistido em campo próprio com AES-256-GCM ou mecanismo equivalente aprovado;
- chave fora do banco e gerenciada por serviço de chaves;
- resposta Store retorna somente `MaskedFederalTaxId`;
- proibido em Stripe, Gelato, PostHog, Sentry e logs;
- CPF de carrinho abandonado é purgado após 7 dias;
- snapshot necessário do pedido permanece criptografado e acessível apenas em fluxo auditado.

Consentimentos obrigatórios:

- Termos de Compra;
- Política de Trocas;
- ciência da Política de Privacidade.

Cada `ConsentReceipt` deve registrar:

- tipo/finalidade;
- versão do documento;
- timestamp;
- Customer;
- cart;
- correlation ID;
- IP somente quando juridicamente necessário.

User agent não é armazenado. Retenção permanece sujeita a revisão jurídica antes do go-live.

### 7.7 Frete

| operationId | Método | Rota |
|---|---|---|
| `quoteShippingOptions` | POST | `/store/carts/{id}/shipping-options/quote` |
| `selectShippingOption` | PUT | `/store/carts/{id}/shipping-option` |

Cotação:

- exige checkout validado e endereço completo;
- usa itens, destino e versão atuais;
- retorna referência opaca, preço, prazo total em dias úteis e expiração;
- oculta provider interno;
- TTL máximo de 30 minutos;
- pode indicar transportadora pública quando disponível;
- não oferece fallback no M1;
- falha de provider não altera carrinho nem cria pagamento.

Seleção:

- exige `shippingOptionRef` opaca, vigente e pertencente ao carrinho;
- recalcula totais;
- persiste seleção e novo `ETag`;
- mudança de endereço, item, quantidade, preço ou publicação revoga cotação/seleção;
- opção anterior nunca é restaurada automaticamente;
- mudança relevante invalida tentativa de pagamento incompatível.

### 7.8 Pagamento por cartão

| operationId | Método | Rota |
|---|---|---|
| `createCardPaymentAttempt` | POST | `/store/carts/{id}/payment-attempts/card` |
| `getPaymentAttemptStatus` | POST | `/store/carts/{id}/payment-attempts/status` |
| `invalidatePaymentAttempt` | POST | `/store/carts/{id}/payment-attempts/invalidate` |

`createCardPaymentAttempt`:

- exige checkout completo, frete válido, consentimentos, total maior que zero e versão atual;
- deriva `amount`, `currency`, cart, Customer e PaymentIntent;
- nunca aceita valores autoritativos do consumidor;
- cria ou reutiliza tentativa compatível pela `Idempotency-Key`;
- retorna `client_secret` efêmero e `confirmationToken` BFF-only;
- marca ambos como sensíveis no contrato;
- nunca inclui PaymentIntent ID em DTO público;
- preserva a regra de que sucesso client-side não cria `Order`.

Estados reutilizáveis:

- `requires_payment_method`;
- `requires_confirmation`;
- `requires_action`.

Estados bloqueantes:

- `processing`;
- `succeeded`;
- `canceled`;
- `invalidated`;
- `expired`.

`getPaymentAttemptStatus`:

- usa POST para evitar referências em URL;
- exige autorização e vínculo ao carrinho/Customer;
- retorna estado público reduzido e ação permitida;
- orienta consulta antes de retry após erro de rede incerto.

`invalidatePaymentAttempt`:

- é idempotente;
- marca tentativa incompatível como invalidada;
- cancela PaymentIntent em best effort;
- não apaga evidências;
- impede reutilização de `client_secret`;
- é acionada por mudança estrutural de carrinho/endereço/frete.

Webhook tardio de tentativa invalidada:

```text
ingerir e deduplicar
→ responder 2xx
→ não criar Order a partir do carrinho atual
→ registrar PAYMENT_SUCCEEDED_FOR_INVALIDATED_ATTEMPT
→ marcar RECONCILIATION_REQUIRED
→ criar alerta crítico
```

### 7.9 Confirmação assíncrona

| operationId | Método | Rota |
|---|---|---|
| `exchangePaymentConfirmationToken` | POST | `/store/payment-confirmations/exchange` |
| `getPaymentConfirmationStatus` | POST | `/store/payment-confirmations/status` |
| `getConfirmedOrderSummary` | GET | `/store/orders/{orderReference}/confirmation` |

`confirmationToken`:

- 32 bytes CSPRNG;
- persistido somente como SHA-256;
- uso único;
- TTL de 30 minutos;
- vinculado a Customer, tentativa e versão do carrinho;
- trafega somente em body HTTPS BFF → backend;
- nunca aparece em URL, HTML, analytics, Sentry ou logs.

Troca:

- exige publishable key, Customer JWT e `Idempotency-Key`;
- consome token atomicamente;
- retry com mesma chave retorna a mesma sessão válida;
- token consumido por outra operação é rejeitado sem revelar estado financeiro;
- retorna `confirmationSessionRef` opaca e `expiresAt`;
- a referência é BFF-only e marcada como sensível.

Consulta:

- recebe a referência no body;
- verifica Customer, expiração e vínculo;
- aplica rate limit e `Retry-After`;
- retorna `retryAfterMs`;
- usa os estados:

```text
AWAITING_PROVIDER
PROCESSING_WEBHOOK
ORDER_CONFIRMED
PAYMENT_RETRY_REQUIRED
PAYMENT_CANCELED
PAYMENT_INVALIDATED
PAYMENT_EXPIRED
RECONCILIATION_REQUIRED
CONFIRMATION_SESSION_EXPIRED
CONFIRMATION_UNKNOWN
```

Semântica:

- `ORDER_CONFIRMED` é terminal e somente ocorre após `Order` persistido;
- `PAYMENT_RETRY_REQUIRED` permite corrigir e iniciar nova tentativa;
- `RECONCILIATION_REQUIRED` encerra polling automático e mantém lock;
- `CONFIRMATION_UNKNOWN` é terminal de UX, não estado financeiro terminal;
- e-mail, PostHog ou Gelato não bloqueiam `ORDER_CONFIRMED`.

### 7.10 Resumo de pedido confirmado

`GET /store/orders/{orderReference}/confirmation`:

- exige publishable key e Customer JWT;
- verifica propriedade do pedido;
- usa `orderReference` opaca e não sequencial;
- referência isolada não concede acesso;
- permite acesso direto por 24 horas após confirmação;
- após TTL retorna `404 CONFIRMATION_NOT_FOUND`;
- funciona em outro dispositivo autenticado na mesma conta;
- retorna apenas:
  - referência pública;
  - data;
  - itens sanitizados;
  - totais;
  - frete selecionado;
  - estados públicos;
  - e-mail e CEP mascarados;
  - endereço mínimo necessário;
- não retorna Stripe IDs, provider IDs, CPF completo, metadata Gelato ou dados de auditoria.

### 7.11 Catálogo público

O contrato de catálogo DEVE:

- retornar somente produtos publicados e variantes vendáveis;
- expor identificador, handle público, título, descrição editorial, opções, variantes, mídia, disponibilidade e preço;
- ocultar metadata e templates Gelato;
- declarar a estratégia canônica de resolução da página de produto;
- suportar cache público seguro e revalidação;
- usar campos fechados, sem expansão arbitrária de entidades internas.

A resolução por handle deve ser materializada no Store OpenAPI antes da implementação da rota `/produtos/[handle-ou-id]`, seja por filtro exato documentado em `GET /store/products` ou por operação específica. O frontend não deve inferir essa resolução.

### 7.12 Headers transversais

| Header | Regra |
|---|---|
| `x-publishable-api-key` | obrigatório nas rotas `/store` aplicáveis |
| `Authorization` | Customer JWT ou token de propósito específico |
| `x-indicio-guest-cart-token` | capability convidada; sensível |
| `If-Match` | versão exigida em mutações concorrentes |
| `ETag` | versão canônica retornada |
| `Idempotency-Key` | obrigatório em mutações repetíveis |
| `x-correlation-id` | recebido ou gerado; sanitizado |
| `Retry-After` | rate limit e polling |
| `Content-Type` | `application/json` |

Regras adicionais:

- `Idempotency-Key` é escopada por ator, operação e recurso;
- payload incompatível com chave já usada retorna conflito estável;
- `x-correlation-id` inválido é substituído;
- headers sensíveis nunca são refletidos em body ou logs.

### 7.13 Schemas mínimos

O registry DEVE incluir:

- `StoreMajorMoney`;
- `StoreMinorMoney`;
- `MoneyUnit`;
- `StoreCartResponse`;
- `GuestCartContext`;
- `CartMergeRequest`;
- `CartMergeResponse`;
- `CartMergeRejectedItem`;
- `CartReviewState`;
- `CheckoutDetailsDraftRequest`;
- `CheckoutDetailsDraftResponse`;
- `CheckoutValidationRequest`;
- `CheckoutValidationResponse`;
- `BrazilianShippingAddress`;
- `MaskedFederalTaxId`;
- `ConsentReceipt`;
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
- `PaymentConfirmationExchangeRequest`;
- `PaymentConfirmationExchangeResponse`;
- `PaymentConfirmationStatusRequest`;
- `PaymentConfirmationStatusResponse`;
- `ConfirmedOrderItem`;
- `ConfirmedOrderSummary`;
- `StoreErrorResponse`;
- `AuthVerificationState`;
- schemas de identidade, senha, token e Customer.

Schemas devem ser fechados quando possível e marcar secrets/capabilities com `writeOnly`, `x-sensitive` ou extensão equivalente reconhecida pelos gates.

---

## 8. Fluxos funcionais

### 8.1 Jornada principal

```text
Catálogo
→ produto
→ criação lazy do carrinho convidado
→ mutações com capability e ETag
→ cadastro/login
→ merge transacional
→ checkout autenticado
→ validação de endereço, CPF e consentimentos
→ cotação e seleção de frete
→ criação da tentativa
→ troca do token de confirmação pelo BFF
→ Stripe Payment Element/3DS
→ polling seguro
→ webhook Stripe
→ Order
→ resumo confirmado
```

### 8.2 Cadastro e merge

```text
registerCustomerIdentity
→ registration JWT
→ createCustomer
→ sessão inicial
→ requestEmailVerification
→ mergeCustomerCart
→ revisão quando necessária
→ checkout
```

### 8.3 Alteração estrutural durante pagamento

```text
item/endereço/frete muda
→ versão do carrinho avança
→ cotação e seleção são revogadas
→ tentativa incompatível é invalidada
→ client_secret deixa de ser reutilizável
→ nova validação/frete/tentativa são exigidos
```

### 8.4 Confirmação

```text
createCardPaymentAttempt
→ confirmationToken
→ exchangePaymentConfirmationToken
→ confirmationSessionRef
→ cookie HttpOnly no BFF
→ stripe.confirmPayment
→ /checkout/processando
→ getPaymentConfirmationStatus
→ webhook canônico
→ ORDER_CONFIRMED
→ getConfirmedOrderSummary
```

### 8.5 Falha externa

Falhas de Resend, PostHog ou Gelato:

- não desfazem pagamento;
- não impedem confirmação do pedido;
- permanecem em outboxes/retries;
- produzem alerta quando persistentes.

---

## 9. Requisitos funcionais consolidados

### 9.1 Fundação e contrato

| ID | Requisito | Estado |
|---|---|---|
| BE-FE-FND-001 | BFF é o único consumidor storefront da Store API | Aprovado — pendente |
| BE-FE-FND-002 | Todas as operações MUST existem no OpenAPI 1.1.0 | Aprovado — pendente |
| BE-FE-FND-003 | Erros usam envelope fechado e correlation ID | Aprovado — pendente |
| BE-FE-FND-004 | Mutações repetíveis usam idempotência | Aprovado — pendente |
| BE-FE-FND-005 | Recursos concorrentes usam ETag/If-Match | Aprovado — pendente |

### 9.2 Autenticação

| ID | Requisito | Estado |
|---|---|---|
| BE-FE-AUTH-001 | Cadastro em identidade + Customer | Aprovado — pendente |
| BE-FE-AUTH-002 | Login aplica verificação flexível | Aprovado — pendente |
| BE-FE-AUTH-003 | Reset e atualização de senha | Aprovado — pendente |
| BE-FE-AUTH-004 | Refresh somente com JWT válido | Aprovado — pendente |
| BE-FE-AUTH-005 | Alteração de credencial revoga tokens anteriores | Aprovado — pendente |
| BE-FE-AUTH-006 | Verificação de e-mail solicitável, reenviável e confirmável | Aprovado — pendente |

### 9.3 Carrinho

| ID | Requisito | Estado |
|---|---|---|
| BE-FE-CART-001 | Criar carrinho convidado com capability | Aprovado — pendente |
| BE-FE-CART-002 | Adicionar, atualizar, remover e esvaziar | Aprovado — pendente |
| BE-FE-CART-003 | Quantidade entre 1 e 99 | Aprovado — pendente |
| BE-FE-CART-004 | Merge transacional completo/parcial | Aprovado — pendente |
| BE-FE-CART-005 | Revisão bloqueia checkout até reconhecimento | Aprovado — pendente |
| BE-FE-CART-006 | Mudança estrutural revoga dependências | Aprovado — pendente |

### 9.4 Checkout e frete

| ID | Requisito | Estado |
|---|---|---|
| BE-FE-CHK-001 | Checkout exclusivamente autenticado | Aprovado — pendente |
| BE-FE-CHK-002 | Draft e validação final separados | Aprovado — pendente |
| BE-FE-CHK-003 | Endereço BR estruturado | Aprovado — pendente |
| BE-FE-CHK-004 | CPF criptografado e mascarado | Aprovado — pendente |
| BE-FE-CHK-005 | Consentimentos versionados | Aprovado — pendente |
| BE-FE-SHP-001 | Cotação autoritativa e expiráveis | Aprovado — pendente |
| BE-FE-SHP-002 | Seleção por referência opaca | Aprovado — pendente |
| BE-FE-SHP-003 | Revogação por mudança de contexto | Aprovado — pendente |

### 9.5 Pagamento e confirmação

| ID | Requisito | Estado |
|---|---|---|
| BE-FE-PAY-001 | Criar/reutilizar tentativa compatível | Aprovado — pendente |
| BE-FE-PAY-002 | Consultar status antes de retry incerto | Aprovado — pendente |
| BE-FE-PAY-003 | Invalidar tentativa incompatível | Aprovado — pendente |
| BE-FE-CONF-001 | Token de confirmação BFF-only | Aprovado — pendente |
| BE-FE-CONF-002 | Troca atômica e idempotente | Aprovado — pendente |
| BE-FE-CONF-003 | Polling com rate limit e backoff | Aprovado — pendente |
| BE-FE-CONF-004 | `ORDER_CONFIRMED` somente após `Order` | Entregue como invariante; interface pendente |
| BE-FE-CONF-005 | Resumo reduzido e autorizado | Aprovado — pendente |
| BE-FE-CONF-006 | Sucesso tardio invalidado exige reconciliação | Aprovado — pendente |

### 9.6 Catálogo e revalidação

| ID | Requisito | Estado |
|---|---|---|
| BE-FE-CAT-001 | Campos públicos fechados | Entregue parcialmente; contrato-alvo pendente |
| BE-FE-CAT-002 | Resolução canônica de produto/handle | Aprovado — pendente |
| BE-FE-CAT-003 | Evento assinado de revalidação | Aprovado — pendente |
| BE-FE-CAT-004 | Metadata Gelato nunca é pública | Entregue |

---

## 10. Dados, dinheiro e concorrência

### 10.1 Dinheiro

Contratos Store atuais usam:

- catálogo/carrinho: `brl-major`;
- `PaymentAttempt.amount`: `brl-minor`.

Schemas explícitos:

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

Regras:

- unidade é obrigatória em todo schema monetário;
- valores autoritativos são derivados no backend;
- total negativo é inválido;
- frete zero é tecnicamente permitido;
- total final zero é rejeitado no M1;
- conversões ocorrem somente em fronteiras testadas;
- cálculo autoritativo não usa ponto flutuante sem estratégia decimal explícita.

### 10.2 Versão do carrinho

A versão:

- é monotônica;
- muda quando itens, endereço, consentimentos, frete ou totais relevantes mudam;
- é serializada como `ETag`;
- é exigida por `If-Match` nas mutações concorrentes;
- vincula cotações, seleção, tentativa e confirmação;
- impede uso de snapshot financeiro desatualizado.

### 10.3 Idempotência

A chave:

- é obrigatória em criação de carrinho, merge, checkout, frete, pagamento, invalidação e troca de confirmação;
- é escopada por operação, ator e recurso;
- persiste resultado suficiente para retry seguro;
- rejeita reutilização com payload semanticamente incompatível;
- possui retenção documentada por operação;
- não substitui locks ou constraints de banco.

### 10.4 Entidades adicionais necessárias

A implementação pode estender o modelo com entidades equivalentes a:

- `GuestCartAccess`;
- `CartReview`;
- `ConsentReceipt`;
- `ShippingQuote`;
- `PaymentConfirmationToken`;
- `PaymentConfirmationSession`;
- `EmailVerificationToken`;
- `CatalogRevalidationEvent`.

O DB Model deve ser atualizado antes da implementação quando nova persistência for necessária.

---

## 11. Segurança, privacidade e retenção

### 11.1 Dados proibidos em logs e telemetry

- CPF completo;
- e-mail completo quando não necessário;
- endereço completo;
- cookies;
- JWT;
- `Authorization`;
- `client_secret`;
- `guestCartToken`;
- `confirmationToken`;
- `confirmationSessionRef`;
- PaymentIntent ID;
- QR/copia-e-cola Pix;
- secrets e assinaturas de webhook;
- bodies completos por padrão.

### 11.2 Respostas públicas

- usam allowlist;
- não expõem metadata Gelato;
- não expõem IDs internos de providers;
- mascaram CPF, CEP e e-mail quando aplicável;
- não refletem capabilities;
- não aceitam identidade do operador/Customer pelo body.

### 11.3 Rate limit

Rate limit específico deve cobrir:

- login;
- cadastro;
- reset de senha;
- verificação/resend;
- criação de carrinho;
- cotação de frete;
- tentativa de pagamento;
- troca e polling de confirmação.

Resposta `429` inclui `Retry-After` e envelope sanitizado.

### 11.4 Retenção proposta

| Dado | Regra |
|---|---|
| CPF em carrinho abandonado | purge após 7 dias |
| CPF em Order | criptografado, retenção conforme obrigação operacional/legal |
| prova de Termos de Compra | proposta de 5 anos |
| ciência da Privacidade | proposta de 5 anos |
| registro de acesso legal | mínimo proposto de 6 meses |
| user agent | não armazenar |
| tokens de confirmação | hash e TTL de 30 minutos |
| capability de carrinho | hash até consumo, expiração ou conclusão |

Retenções jurídicas são gate de go-live e podem ser ajustadas sem enfraquecer minimização e criptografia.

---

## 12. Erros e semântica HTTP

### 12.1 Envelope

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

Mensagens não devem revelar existência de conta, estado financeiro interno, provider ou detalhes de autorização.

### 12.2 Códigos obrigatórios

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

### 12.3 Status HTTP

| Status | Uso |
|---|---|
| 200 | consulta ou mutação idempotente reutilizada |
| 201 | recurso criado |
| 202 | operação aceita para processamento assíncrono |
| 400 | schema ou validação geral inválida |
| 401 | autenticação ausente/expirada |
| 403 | ator autenticado sem acesso |
| 404 | recurso ausente ou ocultado por segurança |
| 409 | conflito de estado/idempotência |
| 412 | `If-Match` incompatível |
| 422 | validação de domínio com `fieldErrors` |
| 429 | rate limit |
| 500 | falha interna sanitizada |
| 503 | dependência obrigatória indisponível |

---

## 13. Observabilidade e eventos

### 13.1 Correlation ID

- aceitar somente formato e tamanho allowlisted;
- gerar quando ausente/inválido;
- devolver em header e, quando seguro, no erro;
- propagar para jobs e integrações;
- não usar token ou ID sensível como correlation ID.

### 13.2 Eventos mínimos

- carrinho criado/recuperado/expirado;
- mutação aplicada ou conflito de versão;
- merge e outcome;
- revisão reconhecida;
- checkout draft/validation;
- CPF validado sem registrar valor;
- cotação/seleção/revogação de frete;
- tentativa criada/reutilizada/invalidada;
- token de confirmação emitido/consumido/expirado;
- polling rate-limited;
- webhook ingerido/deduplicado;
- `Order` criado/reutilizado;
- reconciliação requerida;
- resumo de confirmação acessado;
- revalidação de catálogo enfileirada/entregue;
- falhas de PostgreSQL, Redis ou providers.

### 13.3 Analytics

`purchase_completed`:

- é persistido localmente uma única vez;
- é emitido somente após `Order`;
- nunca é emitido pelo frontend;
- não depende do acesso à página de confirmação;
- não inclui CPF, e-mail, CEP, cart ID, Customer ID ou referências sensíveis.

---

## 14. Integrações externas

### 14.1 Stripe

- secret key somente no backend;
- publishable key somente no frontend;
- `client_secret` efêmero;
- webhooks com raw body e assinatura;
- sucesso/cancelamento/falha idempotentes;
- `Order` somente em `payment_intent.succeeded`;
- cancelamento da tentativa invalidada é best effort;
- evento tardio incompatível gera reconciliação.

### 14.2 Resend

- verificação de e-mail e confirmação de pedido usam outbox;
- falha de envio não bloqueia sessão inicial nem `Order`;
- tokens de e-mail são uso único, expiram e são armazenados por hash;
- respostas públicas são anti-enumeração.

### 14.3 Gelato

- não recebe CPF;
- não recebe metadata além do necessário;
- dispatch continua posterior ao `Order` e à elegibilidade local;
- falha externa não bloqueia confirmação ao frontend.

### 14.4 PostHog e Sentry

- payloads sanitizados;
- sem capabilities ou PII;
- falha externa não altera estado transacional.

### 14.5 Webhook Next.js

- segredo próprio, independente de Stripe/Gelato;
- HMAC, timestamp e event ID;
- retry com backoff;
- sem bloqueio da mutação de catálogo.

---

## 15. Testes e artefatos obrigatórios

### 15.1 Artefatos

Antes de Mock Development:

- PRD Backend atualizado;
- SRS atualizado;
- matriz `FRONTEND_CONTRACT_TRACEABILITY.md`;
- registry TypeScript atualizado;
- Store OpenAPI `1.1.0`;
- Webhooks OpenAPI com evento de revalidação;
- tipos gerados;
- schemas Zod;
- fixtures positivas e negativas;
- mock server;
- contract tests;
- CI de drift.

### 15.2 Contract tests

Devem validar:

- métodos, paths e `operationId`;
- security schemes;
- headers sensíveis;
- request/response;
- status HTTP;
- `ETag`/`If-Match`;
- idempotência;
- unidades monetárias;
- masking;
- códigos de erro;
- ausência de campos proibidos;
- token de confirmação fora de URL;
- consumo único e retry idempotente;
- ownership do pedido;
- equivalência OpenAPI/Zod/fixtures;
- assinatura e deduplicação da revalidação.

### 15.3 Integração

Cenários:

- cadastro em duas etapas;
- login verificado/não verificado;
- reset e revogação;
- carrinho guest capability;
- mutações e conflito;
- merge completo/parcial;
- revisão;
- checkout draft/final;
- CPF inválido e purge;
- frete disponível/indisponível/expirado;
- tentativa reutilizada/incompatível;
- invalidação;
- troca de token;
- 3DS;
- erro incerto;
- polling;
- reconciliação;
- `Order` confirmado;
- resumo autorizado;
- múltiplas abas representadas por chamadas concorrentes.

### 15.4 Gates

```bash
npm run openapi:verify:store
npm run openapi:verify:admin
npm run openapi:verify:webhooks
npm run openapi:lint
npm run openapi:check
npm test
npm run lint
npm run build
git diff --check
```

Qualquer falha relevante resulta em `BLOCKED`. Não existe `PASS WITH KNOWN DEBTS`.

---

## 16. Deploy e operação

A extensão Frontend M1 não autoriza deploy automático.

Deploy deve:

1. selecionar candidate SHA explícito;
2. executar migrações seguras no processo `release`;
3. iniciar `web` e `worker`;
4. validar `/health/live` e `/health/ready`;
5. validar PostgreSQL e Redis;
6. verificar SHA retornado contra a release atual;
7. executar smokes read-only e testes autorizados;
8. preservar evidências sanitizadas.

Mudanças de variáveis Heroku, secrets, domínios, CORS, webhook e chaves exigem autorização humana.

---

## 17. Critérios de aceite

### 17.1 Aceite documental

Este PRD é aceito quando:

- não confunde as-built com target;
- cobre todas as operações MUST do frontend;
- define segurança, dinheiro, idempotência, concorrência e erros;
- possui rastreabilidade para o PRD Frontend;
- não deixa endpoint necessário sem decisão explícita.

### 17.2 Aceite de artefatos

O Gate de Artefatos passa quando:

- OpenAPI 1.1.0 contém todas as operações;
- schemas mínimos estão materializados;
- Zod, fixtures e mocks equivalem ao OpenAPI;
- contract tests passam;
- SRS, DB Model e matriz estão alinhados;
- nenhum secret ou PII aparece em exemplo;
- gates de lint/build/test/drift passam.

### 17.3 Aceite de integração

O backend está pronto para integração do Frontend M1 quando:

- BFF consegue executar a jornada completa por contratos aprovados;
- carrinho convidado usa capability;
- merge e revisão funcionam;
- checkout autenticado e CPF protegido funcionam;
- frete é autoritativo e revogável;
- PaymentAttempt e confirmação são recuperáveis;
- `Order` depende do webhook;
- resumo confirmado é seguro;
- revalidação de catálogo é assinada;
- observabilidade está sanitizada;
- preview e produção validam CORS, domínios, rate limits e secrets.

---

## 18. Rastreabilidade com o frontend

| Requisito frontend | Responsabilidade backend |
|---|---|
| FE-FND-002/003/007 | BFF boundary, OpenAPI e schemas executáveis |
| FE-CAT-001–005 | catálogo público fechado e revalidação |
| FE-CART-001–008 | capability, mutações, merge, revisão e ETag |
| FE-AUTH-001–007 | identidade, Customer, login, reset, refresh e verificação |
| FE-CHK-001–006 | autenticação, draft, validação, CPF e consentimentos |
| FE-SHP-001–004 | cotação, seleção, expiração e ausência de fallback |
| FE-PAY-001–006 | tentativa compatível, Stripe e invalidação |
| FE-CONF-001–006 | token, sessão, polling, reconciliação e resumo |
| FE-CNT-001–005 | versões de documentos e recibos; revisão jurídica externa |

A matriz detalhada deve registrar operationId, schema, fixture, teste e estado de implementação por requisito.

---

## 19. Pendências e gates

### 19.1 Pendências imediatas

1. atualizar SRS v1.5;
2. atualizar DB Model quando persistência adicional for confirmada;
3. criar matriz de rastreabilidade;
4. atualizar registry;
5. gerar Store OpenAPI 1.1.0;
6. atualizar Webhooks OpenAPI;
7. criar Zod e tipos;
8. criar fixtures/mocks;
9. criar contract tests;
10. executar gates globais.

### 19.2 Estado

```text
Gate de Decisões A–J: PASS
Gate de Decisões R: PASS
PRD Backend alinhado ao frontend: PASS
Gate de Artefatos: PENDING
PASS DOCUMENTAL: não concedido
PASS PARA MOCK DEVELOPMENT: não concedido
PASS PARA INTEGRAÇÃO: não concedido
```

---

## 20. Referências canônicas

- `docs/PRD_frontend_v1.1.md`;
- `docs/SRS_v1.5.md`;
- `docs/DB_MODEL_v1.21.md`;
- `docs/openapi/README.md`;
- `apps/backend/src/api-docs/generated/store.openapi.json`;
- `apps/backend/src/api-docs/generated/admin.openapi.json`;
- `apps/backend/src/api-docs/generated/webhooks.openapi.json`;
- `apps/backend/src/api-docs/operations/store/`;
- `apps/backend/src/api-docs/components/security-schemes.ts`;
- `apps/backend/.env.template`;
- `ops/API_DOCS.md`;
- `.planning/PROJECT.md`;
- `.planning/STATE.md`.

---

*Última revisão: 2026-08-06 — PRD Backend alinhado ao contrato-alvo do Frontend Milestone 1. A revisão preserva o backend v1.0 entregue, especifica as extensões necessárias e mantém o Gate de Artefatos como pendente.*
