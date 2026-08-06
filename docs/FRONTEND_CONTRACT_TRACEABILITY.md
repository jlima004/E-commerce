# Frontend Contract Traceability — Indicio Cult

| Campo | Valor |
|---|---|
| Documento | Matriz de Rastreabilidade Frontend ↔ Backend ↔ Contratos |
| Projeto | E-commerce headless Print-on-Demand da Indicio Cult |
| Versão | 1.0.0 |
| Data | 2026-08-06 |
| Status | Canônico de rastreabilidade — decisões completas; artefatos executáveis pendentes |
| Base | PRD Frontend v1.1.2 · PRD Backend v1.1.1 · SRS v1.5.2 |
| Contrato-alvo | Store OpenAPI `1.1.0` |
| Gate vigente | `DECISIONS COMPLETE, ARTIFACTS PENDING` |

> **Objetivo:** este documento conecta cada requisito `FE-*` do Frontend Milestone 1 à responsabilidade correspondente do backend, ao requisito SRS, à operação de contrato, aos schemas, às fixtures e aos testes necessários para comprovação.

> **Regra de estado:** referência a uma operação, schema, fixture ou teste neste documento não significa que o artefato já existe. Enquanto a coluna **Estado** indicar `ARTIFACT PENDING`, o item representa contrato-alvo aprovado, não implementação comprovada.

> **Gate:** esta matriz materializa a rastreabilidade documental, mas não concede `PASS DOCUMENTAL`, `PASS PARA MOCK DEVELOPMENT` ou `PASS PARA INTEGRAÇÃO`. Esses gates dependem dos artefatos executáveis e das evidências definidos neste documento.

---

## 1. Convenções

### 1.1 Estados

| Estado | Significado |
|---|---|
| `AS-BUILT PASS` | Comportamento já entregue no backend v1.0 e preservado |
| `PARTIAL AS-BUILT` | Parte do comportamento existe; extensão contratual ainda é necessária |
| `DECISION PASS / ARTIFACT PENDING` | Decisão aprovada; registry/OpenAPI/schema/fixture/teste ainda não comprovados |
| `BFF-ONLY` | Responsabilidade exclusiva do frontend/BFF, sem nova operação Store |
| `EXTERNAL GATE` | Depende de decisão jurídica, domínio, provider ou configuração externa |
| `POSTERIOR` | Fora do Frontend Milestone 1 |

### 1.2 Evidência mínima por requisito de contrato

Um requisito somente muda de `ARTIFACT PENDING` para artefato comprovado quando existir evidência verificável de:

1. operationId e path no registry quando aplicável;
2. operação no Store OpenAPI ou Webhooks OpenAPI gerado;
3. request/response schemas fechados;
4. security schemes e headers corretos;
5. fixture positiva;
6. fixture negativa relevante;
7. schema Zod equivalente no frontend;
8. contract test cobrindo request, response e erro;
9. teste HTTP/backend quando houver comportamento customizado;
10. gates de drift, lint, test e build passando.

### 1.3 Artefatos-alvo

Os nomes abaixo são convenções de rastreabilidade. O layout final pode variar desde que a equivalência permaneça explícita.

```text
Backend
apps/backend/src/api-docs/
  operations/store/
  schemas/
  generated/store.openapi.json
  generated/webhooks.openapi.json

docs/contracts/
  fixtures/store/
  fixtures/webhooks/

Frontend futuro
src/contracts/generated/
src/contracts/zod/
src/contracts/fixtures/
src/contracts/adapters/
```

---

## 2. Resumo de cobertura

| Grupo | Requisitos FE | Cobertura de decisão | Artefatos executáveis |
|---|---:|---|---|
| Fundação | 7 | 7/7 | PENDING |
| Catálogo | 5 | 5/5 | Parcial + PENDING |
| Carrinho | 8 | 8/8 | PENDING |
| Autenticação | 7 | 7/7 | PENDING |
| Checkout | 6 | 6/6 | PENDING |
| Frete | 4 | 4/4 | PENDING |
| Pagamento | 6 | 6/6 | Parcial + PENDING |
| Confirmação | 6 | 6/6 | PENDING |
| Conteúdo/Legal | 5 | 5/5 | Parcial + EXTERNAL GATE |
| **Total** | **54** | **54/54** | **Gate de Artefatos PENDING** |

---

## 3. Fundação e integração

| FE ID | Requisito frontend | Backend/SRS | Contrato/artefato | Schemas / evidência | Estado |
|---|---|---|---|---|---|
| FE-FND-001 | Next.js App Router com TypeScript estrito | Responsabilidade frontend | BFF/frontend | `tsconfig`, build frontend | BFF-ONLY |
| FE-FND-002 | BFF same-origin obrigatório | BE-FE-FND-001 · SRS-FE-FND-001 | Limite navegador → BFF → Medusa | testes de arquitetura; nenhuma chamada browser → Medusa | DECISION PASS / ARTIFACT PENDING |
| FE-FND-003 | Adapter tipado e Zod runtime | BE-FE-FND-002 · SRS-FE-FND-002 | Store OpenAPI → tipos → Zod → adapter | tipos gerados, Zod, fixtures equivalentes | DECISION PASS / ARTIFACT PENDING |
| FE-FND-004 | Nenhum componente consome Medusa diretamente | SRS-FE-FND-001 | Regra de arquitetura frontend | lint/import-boundary ou teste equivalente | BFF-ONLY |
| FE-FND-005 | Correlation ID sanitizado | BE-FE-FND-003 · SRS-NFR-010 | `x-correlation-id` transversal | `StoreErrorResponse`; HTTP tests | DECISION PASS / ARTIFACT PENDING |
| FE-FND-006 | Configuração pública separada de secrets | SRS-NFR-012 | env frontend/backend | `.env.template`, secret scanning | PARTIAL AS-BUILT |
| FE-FND-007 | OpenAPI é gate para qualquer rota upstream | BE-FE-FND-002 · SRS-FE-FND-002 | Store OpenAPI `1.1.0` | `openapi:check`, drift CI | DECISION PASS / ARTIFACT PENDING |

### 3.1 Contratos transversais obrigatórios

Todas as operações Store aplicáveis devem documentar corretamente:

- `x-publishable-api-key`;
- `Authorization`;
- `x-indicio-guest-cart-token` quando necessário;
- `If-Match` e `ETag` quando versionadas;
- `Idempotency-Key` em mutações repetíveis;
- `x-correlation-id`;
- `Retry-After` em `429` e polling;
- `Content-Type: application/json`.

Teste mínimo: uma suite transversal deve falhar se uma operação marcada pela matriz omitir header, security scheme, erro ou unidade monetária obrigatória.

---

## 4. Catálogo

| FE ID | Requisito frontend | Backend/SRS | operationId / rota | Schemas | Fixtures / testes | Estado |
|---|---|---|---|---|---|---|
| FE-CAT-001 | Listar produtos vendáveis | BE-FE-CAT-001 · SRS-FE-CAT-001 | `storeProductsList` · `GET /store/products` | catálogo público fechado | published/sellable; unpublished; unsellable | PARTIAL AS-BUILT |
| FE-CAT-002 | Exibir produto e variantes públicas | BE-FE-CAT-001/002 · SRS-FE-CAT-001/002 | `storeProductsRetrieve` e resolução por handle aprovada | Product, Variant, Option, PublicMedia, StoreMajorMoney | produto válido; variante indisponível; handle inexistente | PARTIAL AS-BUILT |
| FE-CAT-003 | Não expor metadata interna | BE-FE-CAT-004 · SRS-FE-CAT-004 | list/retrieve | schemas com `additionalProperties: false` | assert ausência Gelato/provider metadata | AS-BUILT PASS + contract hardening pending |
| FE-CAT-004 | Cache/revalidação por tags | BE-FE-CAT-003 · SRS-FE-CAT-003 | outbound `catalog-revalidation` | CatalogRevalidationEvent | assinatura válida, duplicata, timestamp inválido, retry | DECISION PASS / ARTIFACT PENDING |
| FE-CAT-005 | Tratar indisponibilidade sem vazar motivo interno | BE-FE-FND-003 · SRS-FE-FND-003 | catálogo + StoreErrorResponse | `StoreErrorResponse` | provider/internal failure sanitizado | DECISION PASS / ARTIFACT PENDING |

### 4.1 Decisão pendente de materialização: resolução por handle

Antes do frontend implementar `/produtos/[handle-ou-id]`, o Store OpenAPI deve materializar uma destas formas aprovadas:

- filtro exato e documentado por `handle` em `GET /store/products`; ou
- operação específica de retrieve por handle.

O frontend não pode inferir busca fuzzy ou selecionar arbitrariamente o primeiro produto retornado.

### 4.2 Webhook de revalidação

Contrato outbound esperado:

```text
POST /api/webhooks/medusa/catalog-revalidation
x-indicio-event-id
x-indicio-event-type
x-indicio-signature
x-indicio-timestamp
```

Evidência obrigatória:

- assinatura HMAC;
- janela de timestamp;
- deduplicação por event ID;
- payload sem metadata interna;
- retry/reprocessamento;
- não bloquear a mutação administrativa original.

---

## 5. Carrinho

| FE ID | Requisito frontend | Backend/SRS | operationId / rota | Schemas | Fixtures / testes | Estado |
|---|---|---|---|---|---|---|
| FE-CART-001 | Criar carrinho lazy | BE-FE-CART-001 · SRS-FE-CART-001 | `createActiveStoreCart` · `POST /store/carts/active` | `GuestCartContext`, `StoreCartResponse` | new cart 201; idempotent retry; no cart on GET | DECISION PASS / ARTIFACT PENDING |
| FE-CART-002 | Proteger carrinho por capability | BE-FE-CART-001 · SRS-FE-CART-001 | create/get/mutations | sensitive guest token header | valid, missing, wrong, revoked, expired capability | DECISION PASS / ARTIFACT PENDING |
| FE-CART-003 | Adicionar, atualizar, remover e esvaziar | BE-FE-CART-002 · SRS-FE-CART-002 | `addCartLineItem`, `updateCartLineItem`, `removeCartLineItem`, `clearCartLineItems` | line item requests + `StoreCartResponse` | add/update/delete/clear; invalid variant | DECISION PASS / ARTIFACT PENDING |
| FE-CART-004 | Quantidade entre 1 e 99 | BE-FE-CART-003 · SRS-FE-CART-003 | add/update | quantity constraints | 1, 99, 0 remove, -1, 100, decimal | DECISION PASS / ARTIFACT PENDING |
| FE-CART-005 | Sincronizar abas | backend fornece versão canônica | ETag em read/mutations | cart version | stale tab receives 412 | DECISION PASS / ARTIFACT PENDING |
| FE-CART-006 | Merge transacional e parcial | BE-FE-CART-004 · SRS-FE-CART-004 | `mergeCustomerCart` · `POST /store/customers/me/cart/merge` | `CartMergeRequest`, `CartMergeResponse`, `CartMergeRejectedItem` | MERGED; PARTIAL; ATTACHED; PRESERVED; NO_ITEMS; rollback | DECISION PASS / ARTIFACT PENDING |
| FE-CART-007 | Bloquear checkout em `requiresReview` | BE-FE-CART-005 · SRS-FE-CART-005 | `acknowledgeCartReview` | `CartReviewState` | checkout blocked; acknowledge; idempotent retry | DECISION PASS / ARTIFACT PENDING |
| FE-CART-008 | Resolver conflitos por ETag | BE-FE-FND-005 · SRS-FE-FND-005 | todas mutações versionadas | `ETag`, `If-Match`, error cart snapshot | success current version; `412 CART_VERSION_MISMATCH` | DECISION PASS / ARTIFACT PENDING |

### 5.1 Capability do carrinho convidado

Propriedades obrigatórias:

- mínimo 32 bytes CSPRNG;
- backend persiste somente SHA-256;
- enviada somente em `x-indicio-guest-cart-token`;
- marcada `x-sensitive: true` ou equivalente;
- nunca aparece em resposta JSON, URL, logs, Sentry ou analytics;
- consumida/revogada em merge comprometido;
- expira/revoga quando carrinho expira ou é completado.

### 5.2 Semântica de merge

Outcomes canônicos:

```text
MERGED
MERGED_PARTIAL
GUEST_CART_ATTACHED
CUSTOMER_CART_PRESERVED
NO_ITEMS
```

Contract tests devem comprovar:

- soma por variante com teto 99;
- rejeição individual de variante inválida;
- transação completa em falha;
- capability não consumida se a transação abortar;
- capability consumida após commit;
- `requiresReview` persistido quando necessário.

---

## 6. Autenticação e sessão

| FE ID | Requisito frontend | Backend/SRS | operationId / rota | Schemas | Fixtures / testes | Estado |
|---|---|---|---|---|---|---|
| FE-AUTH-001 | Cadastro em duas etapas | BE-FE-AUTH-001 · SRS-FE-AUTH-001 | `registerCustomerIdentity`; `createCustomer` | identity/register + Customer schemas | sucesso; identity duplicate anti-enum; Customer creation failure | DECISION PASS / ARTIFACT PENDING |
| FE-AUTH-002 | Login e logout BFF | BE-FE-AUTH-002 · SRS-FE-AUTH-002 | `customerLogin`; logout BFF-only | auth token/Customer | verified; initial-unverified; blocked-unverified; invalid credentials | DECISION PASS / ARTIFACT PENDING |
| FE-AUTH-003 | Reset de senha | BE-FE-AUTH-003 · SRS-FE-AUTH-003 | `requestPasswordReset`; `resetPassword` | reset request/update | known/unknown same public response; valid/expired/used token | DECISION PASS / ARTIFACT PENDING |
| FE-AUTH-004 | Verificação flexível | BE-FE-AUTH-006 · SRS-FE-AUTH-006 | request/resend/confirm/status verification | `AuthVerificationState` | initial session purchase; relogin blocked; verified pass | DECISION PASS / ARTIFACT PENDING |
| FE-AUTH-005 | Renovação somente com JWT válido | BE-FE-AUTH-004 · SRS-FE-AUTH-004 | `refreshCustomerToken` | token response | valid; expired; revoked; malformed JWT | DECISION PASS / ARTIFACT PENDING |
| FE-AUTH-006 | Revogação após alteração de credenciais | BE-FE-AUTH-005 · SRS-FE-AUTH-005 | reset/update + auth guard | token state | old JWT rejected after password change | DECISION PASS / ARTIFACT PENDING |
| FE-AUTH-007 | Sessão absoluta máxima de 30 dias | política BFF + backend JWT | BFF session envelope; auth TTL | `AuthSessionEnvelope` frontend | rolling cookie bounded by originalLoginAt; expired JWT login required | BFF-ONLY + backend token semantics pending |

### 6.1 Operações de autenticação alvo

```text
POST /auth/customer/emailpass/register
POST /store/customers
POST /auth/customer/emailpass
GET  /store/customers/me
POST /auth/customer/emailpass/reset-password
POST /auth/customer/emailpass/update
POST /auth/token/refresh
POST /store/customers/me/verify
POST /store/customers/me/verify/resend
POST /store/customers/verify
GET  /store/customers/me/verify/status
```

### 6.2 Regras anti-enumeração

Testes devem comprovar que:

- reset para e-mail conhecido e desconhecido não permite inferir cadastro;
- resend de verificação não permite inferir conta indevidamente;
- erro de login não diferencia publicamente “usuário não existe” de “senha inválida”;
- tokens de verificação/reset são hash-only, uso único e expiráveis.

---

## 7. Checkout brasileiro

| FE ID | Requisito frontend | Backend/SRS | operationId / rota | Schemas | Fixtures / testes | Estado |
|---|---|---|---|---|---|---|
| FE-CHK-001 | Checkout exclusivamente autenticado | BE-FE-CHK-001 · SRS-FE-CHK-001 | checkout-details, shipping, payment guards | auth security | guest rejected before checkout mutation/quote/payment | DECISION PASS / ARTIFACT PENDING |
| FE-CHK-002 | Rascunho parcial e validação final separada | BE-FE-CHK-002 · SRS-FE-CHK-002 | `patchCartCheckoutDetails`; `validateCartCheckoutDetails` | draft/final schemas | partial valid persisted; invalid CPF not persisted; atomic final failure | DECISION PASS / ARTIFACT PENDING |
| FE-CHK-003 | Endereço BR estruturado | BE-FE-CHK-003 · SRS-FE-CHK-003 | checkout operations | `BrazilianShippingAddress` | valid UF/CEP; non-BR; missing required fields | DECISION PASS / ARTIFACT PENDING |
| FE-CHK-004 | CPF protegido e mascarado | BE-FE-CHK-004 · SRS-FE-CHK-004 | checkout operations | `MaskedFederalTaxId` | valid CPF; invalid; response masking; log redaction; purge | DECISION PASS / ARTIFACT PENDING |
| FE-CHK-005 | CEP via BFF com fallback | responsabilidade BFF | nenhum Store endpoint específico | BFF CEP DTO | ViaCEP success; BrasilAPI fallback; manual input | BFF-ONLY |
| FE-CHK-006 | Consentimentos versionados | BE-FE-CHK-005 · SRS-FE-CHK-005 | checkout-details/validate | `ConsentReceipt` | missing terms; versions persisted; no user agent | DECISION PASS / ARTIFACT PENDING |

### 7.1 CPF

Evidências obrigatórias:

- validação server-side;
- armazenamento AES-256-GCM ou mecanismo equivalente aprovado;
- chave fora do banco;
- resposta Store somente mascarada;
- ausência em Stripe, Gelato, PostHog, Sentry e logs;
- purge de CPF em carrinho abandonado após 7 dias;
- snapshot necessário no Order criptografado e auditável.

### 7.2 Consentimentos

Schemas/testes devem distinguir:

- Termos de Compra;
- Política de Trocas;
- ciência da Política de Privacidade;
- consentimentos opcionais por finalidade, se introduzidos posteriormente.

---

## 8. Frete

| FE ID | Requisito frontend | Backend/SRS | operationId / rota | Schemas | Fixtures / testes | Estado |
|---|---|---|---|---|---|---|
| FE-SHP-001 | Cotação automática | BE-FE-SHP-001 · SRS-FE-SHP-001 | `quoteShippingOptions` · `POST /store/carts/{id}/shipping-options/quote` | `ShippingQuoteRequest`, `ShippingQuoteResponse`, `ShippingOption` | options; unavailable; timeout; stale ETag | DECISION PASS / ARTIFACT PENDING |
| FE-SHP-002 | Seleção autoritativa | BE-FE-SHP-002 · SRS-FE-SHP-002 | `selectShippingOption` · `PUT /store/carts/{id}/shipping-option` | `ShippingSelectionRequest` | valid ref; foreign ref; expired ref; recalculated total | DECISION PASS / ARTIFACT PENDING |
| FE-SHP-003 | Revogação por mudança | BE-FE-SHP-003 · SRS-FE-SHP-003 | cart/checkout/shipping mutations | cart version + quote state | item/address change revokes quote/selection/payment | DECISION PASS / ARTIFACT PENDING |
| FE-SHP-004 | Sem fallback no Milestone 1 | BE-FE-SHP-004 · SRS-FE-SHP-004 | quote error contract | shipping errors | provider unavailable → explicit failure, no invented shipping option | DECISION PASS / ARTIFACT PENDING |

### 8.1 Regras de cotação

- endereço e checkout validados;
- referência opaca;
- preço em BRL com unidade declarada;
- prazo total em dias úteis;
- provider interno oculto;
- TTL máximo de 30 minutos;
- mudança de versão invalida a cotação;
- nenhuma restauração automática de seleção anterior.

---

## 9. Pagamento por cartão

| FE ID | Requisito frontend | Backend/SRS | operationId / rota | Schemas | Fixtures / testes | Estado |
|---|---|---|---|---|---|---|
| FE-PAY-001 | Stripe Payment Element | backend fornece PaymentIntent/client_secret | `createCardPaymentAttempt` | `CardPaymentAttemptRequest/Response` | successful setup; Stripe unavailable | PARTIAL AS-BUILT + target pending |
| FE-PAY-002 | `client_secret` somente em memória | BE-FE-PAY-001 · SRS-FE-PAY-001 | create attempt | sensitive `client_secret` | absent from logs/examples/storage fixtures | PARTIAL AS-BUILT + contract hardening pending |
| FE-PAY-003 | 3DS e return URL segura | Stripe + BFF | create attempt + frontend | PaymentIntent public state | requires_action; redirect return; no sensitive query | DECISION PASS / ARTIFACT PENDING |
| FE-PAY-004 | Idempotência e tentativa compatível | BE-FE-PAY-001 · SRS-FE-PAY-001 | `createCardPaymentAttempt` | attempt compatibility | same key same result; incompatible context rejected | DECISION PASS / ARTIFACT PENDING |
| FE-PAY-005 | Consultar antes de retry após erro incerto | BE-FE-PAY-002 · SRS-FE-PAY-002 | `getPaymentAttemptStatus` · POST status | `PaymentAttemptStatusRequest/Response` | network ambiguity; processing; retry allowed | DECISION PASS / ARTIFACT PENDING |
| FE-PAY-006 | Invalidar em mudança estrutural | BE-FE-PAY-003 · SRS-FE-PAY-003 | `invalidatePaymentAttempt` | invalidation request/response | item/address/shipping change; best-effort cancel; idempotent retry | DECISION PASS / ARTIFACT PENDING |

### 9.1 Pré-condições para tentativa

Contract/integration tests devem provar rejeição quando:

- checkout incompleto;
- `requiresReview=true`;
- frete ausente/expirado;
- consentimentos ausentes;
- total igual a zero;
- `If-Match` desatualizado;
- tentativa incompatível bloqueante já existe.

### 9.2 Dados que o consumidor não pode definir

O request não deve aceitar como autoridade:

- `amount`;
- `currency`;
- cart/customer/order ID no body;
- PaymentIntent ID;
- preços;
- totais;
- provider metadata.

---

## 10. Confirmação assíncrona

| FE ID | Requisito frontend | Backend/SRS | operationId / rota | Schemas | Fixtures / testes | Estado |
|---|---|---|---|---|---|---|
| FE-CONF-001 | Trocar token no servidor | BE-FE-CONF-001/002 · SRS-FE-CONF-001/002 | `exchangePaymentConfirmationToken` | exchange request/response | valid token; used token; expired; same idempotency key | DECISION PASS / ARTIFACT PENDING |
| FE-CONF-002 | Polling com backoff e rate limit | BE-FE-CONF-003 · SRS-FE-CONF-003 | `getPaymentConfirmationStatus` | status request/response | Retry-After; retryAfterMs; 429; session expiry | DECISION PASS / ARTIFACT PENDING |
| FE-CONF-003 | Não confirmar pedido pelo browser | BE-FE-CONF-004 · SRS-FE-CONF-004 | webhook Stripe + status | confirmation states | Stripe client success before webhook ≠ ORDER_CONFIRMED | AS-BUILT invariant + interface pending |
| FE-CONF-004 | Refresh e múltiplas abas | confirmation session server-side | exchange/status | opaque session ref | repeated polling; concurrent calls; no duplicate order/charge | DECISION PASS / ARTIFACT PENDING |
| FE-CONF-005 | Reconciliação controlada | BE-FE-CONF-006 · SRS-FE-CONF-006 | invalidated-late webhook + status | `RECONCILIATION_REQUIRED` | invalidated attempt later succeeds; alert critical | DECISION PASS / ARTIFACT PENDING |
| FE-CONF-006 | Resumo de Order reduzido | BE-FE-CONF-005 · SRS-FE-CONF-005 | `getConfirmedOrderSummary` · `GET /store/orders/{orderReference}/confirmation` | `ConfirmedOrderSummary`, `ConfirmedOrderItem` | owner/non-owner; <24h; >24h; masked fields | DECISION PASS / ARTIFACT PENDING |

### 10.1 Estados canônicos

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

Testes devem assegurar:

- `ORDER_CONFIRMED` apenas depois do `Order` persistido;
- `CONFIRMATION_UNKNOWN` não altera o estado financeiro;
- `RECONCILIATION_REQUIRED` não libera nova cobrança automática;
- falha de Resend/PostHog/Gelato não impede `ORDER_CONFIRMED`.

### 10.2 Token e sessão

`confirmationToken`:

- 32 bytes CSPRNG;
- hash-only;
- uso único;
- TTL 30 min;
- vínculo com Customer, tentativa e versão.

`confirmationSessionRef`:

- opaca;
- BFF-only;
- não aparece em URL ou resposta browser-facing;
- consulta por POST body;
- validada por Customer e expiração.

---

## 11. Conteúdo, políticas e requisitos legais

| FE ID | Requisito frontend | Backend/SRS | Contrato/artefato | Evidência | Estado |
|---|---|---|---|---|---|
| FE-CNT-001 | Política de Privacidade | consent receipt / versão | conteúdo frontend + `ConsentReceipt` | versão persistida quando ciência for registrada | EXTERNAL GATE + artifact pending |
| FE-CNT-002 | Termos de Compra | BE-FE-CHK-005 · SRS-FE-CHK-005 | checkout consent | versão + timestamp + Customer/cart | DECISION PASS / ARTIFACT PENDING |
| FE-CNT-003 | Política de Trocas | BE-FE-CHK-005 · SRS-FE-CHK-005 | checkout consent | versão + timestamp + Customer/cart | DECISION PASS / ARTIFACT PENDING |
| FE-CNT-004 | Canal de suporte | frontend/operacional | nenhuma nova Store operation obrigatória | canal publicado e testado | BFF-ONLY / operational |
| FE-CNT-005 | Revisão jurídica antes do go-live | requisito de governança | gate jurídico | aprovação explícita | EXTERNAL GATE |

### 11.1 Retenção sujeita a jurídico

A matriz registra como proposta, não como parecer jurídico:

- Termos de Compra: 5 anos;
- ciência de Privacidade: 5 anos;
- registros de acesso legalmente exigidos: mínimo proposto de 6 meses;
- user agent: não armazenar;
- CPF de carrinho abandonado: 7 dias.

Qualquer alteração jurídica deve atualizar PRD Backend, SRS e esta matriz antes do go-live.

---

## 12. Matriz operationId → requisitos frontend

| operationId | Método / rota | FE IDs consumidores | Estado |
|---|---|---|---|
| `storeProductsList` | GET `/store/products` | FE-CAT-001, FE-CAT-002, FE-CAT-003, FE-CAT-005 | PARTIAL AS-BUILT |
| `storeProductsRetrieve` | GET `/store/products/{id}` | FE-CAT-002, FE-CAT-003 | PARTIAL AS-BUILT |
| `getActiveStoreCart` | GET `/store/carts/active` | FE-CART-001, FE-CART-002, FE-CART-005 | target naming/contract pending |
| `createActiveStoreCart` | POST `/store/carts/active` | FE-CART-001, FE-CART-002 | target extension pending |
| `addCartLineItem` | POST `/store/carts/{id}/line-items` | FE-CART-003, FE-CART-004, FE-CART-008 | ARTIFACT PENDING |
| `updateCartLineItem` | POST `/store/carts/{id}/line-items/{item_id}` | FE-CART-003, FE-CART-004, FE-CART-008 | ARTIFACT PENDING |
| `removeCartLineItem` | DELETE `/store/carts/{id}/line-items/{item_id}` | FE-CART-003, FE-CART-008 | ARTIFACT PENDING |
| `clearCartLineItems` | DELETE `/store/carts/{id}/line-items` | FE-CART-003, FE-CART-008 | ARTIFACT PENDING |
| `mergeCustomerCart` | POST `/store/customers/me/cart/merge` | FE-CART-006, FE-CART-007 | ARTIFACT PENDING |
| `acknowledgeCartReview` | POST `/store/carts/{id}/review/acknowledge` | FE-CART-007, FE-CART-008 | ARTIFACT PENDING |
| `registerCustomerIdentity` | POST `/auth/customer/emailpass/register` | FE-AUTH-001 | ARTIFACT PENDING |
| `createCustomer` | POST `/store/customers` | FE-AUTH-001 | ARTIFACT PENDING |
| `customerLogin` | POST `/auth/customer/emailpass` | FE-AUTH-002, FE-AUTH-004 | ARTIFACT PENDING |
| `getCustomerMe` | GET `/store/customers/me` | FE-AUTH-001, FE-AUTH-002 | ARTIFACT PENDING |
| `requestPasswordReset` | POST `/auth/customer/emailpass/reset-password` | FE-AUTH-003 | ARTIFACT PENDING |
| `resetPassword` | POST `/auth/customer/emailpass/update` | FE-AUTH-003, FE-AUTH-006 | ARTIFACT PENDING |
| `refreshCustomerToken` | POST `/auth/token/refresh` | FE-AUTH-005 | ARTIFACT PENDING |
| `requestEmailVerification` | POST `/store/customers/me/verify` | FE-AUTH-004 | ARTIFACT PENDING |
| `resendEmailVerification` | POST `/store/customers/me/verify/resend` | FE-AUTH-004 | ARTIFACT PENDING |
| `confirmEmailVerification` | POST `/store/customers/verify` | FE-AUTH-004 | ARTIFACT PENDING |
| `getEmailVerificationStatus` | GET `/store/customers/me/verify/status` | FE-AUTH-004 | ARTIFACT PENDING |
| `patchCartCheckoutDetails` | PATCH `/store/carts/{id}/checkout-details` | FE-CHK-001, FE-CHK-002, FE-CHK-003, FE-CHK-004, FE-CHK-006 | ARTIFACT PENDING |
| `validateCartCheckoutDetails` | POST `/store/carts/{id}/checkout-details/validate` | FE-CHK-001, FE-CHK-002, FE-CHK-003, FE-CHK-004, FE-CHK-006 | ARTIFACT PENDING |
| `quoteShippingOptions` | POST `/store/carts/{id}/shipping-options/quote` | FE-SHP-001, FE-SHP-003, FE-SHP-004 | ARTIFACT PENDING |
| `selectShippingOption` | PUT `/store/carts/{id}/shipping-option` | FE-SHP-002, FE-SHP-003 | ARTIFACT PENDING |
| `createCardPaymentAttempt` | POST `/store/carts/{id}/payment-attempts/card` | FE-PAY-001, FE-PAY-002, FE-PAY-003, FE-PAY-004 | PARTIAL AS-BUILT + extension pending |
| `getPaymentAttemptStatus` | POST `/store/carts/{id}/payment-attempts/status` | FE-PAY-005 | ARTIFACT PENDING |
| `invalidatePaymentAttempt` | POST `/store/carts/{id}/payment-attempts/invalidate` | FE-PAY-006, FE-CONF-005 | ARTIFACT PENDING |
| `exchangePaymentConfirmationToken` | POST `/store/payment-confirmations/exchange` | FE-CONF-001, FE-CONF-004 | ARTIFACT PENDING |
| `getPaymentConfirmationStatus` | POST `/store/payment-confirmations/status` | FE-CONF-002, FE-CONF-003, FE-CONF-004, FE-CONF-005 | ARTIFACT PENDING |
| `getConfirmedOrderSummary` | GET `/store/orders/{orderReference}/confirmation` | FE-CONF-006 | ARTIFACT PENDING |

Operações existentes fora do M1, preservadas mas não consumidas pela nova storefront:

- `storePaymentAttemptCreatePix`;
- `storeTrackingLookup`;
- `storeCustomerCartAttach` durante a janela de depreciação.

---

## 13. Matriz de schemas

| Schema | Usado por | Zod obrigatório | Fixture obrigatória | Estado |
|---|---|---|---|---|
| `StoreMajorMoney` | catálogo/carrinho/frete | Sim | major BRL | ARTIFACT PENDING / existing semantics |
| `StoreMinorMoney` | pagamento/admin boundaries | Sim | minor BRL | ARTIFACT PENDING / existing semantics |
| `MoneyUnit` | todos os valores | Sim | major/minor | ARTIFACT PENDING |
| `StoreCartResponse` | cart/checkout/frete | Sim | guest/auth/review | ARTIFACT PENDING |
| `GuestCartContext` | create cart | Sim, server-only field handling | new/idempotent | ARTIFACT PENDING |
| `CartMergeRequest` | merge | Sim | complete/partial | ARTIFACT PENDING |
| `CartMergeResponse` | merge | Sim | each outcome | ARTIFACT PENDING |
| `CartMergeRejectedItem` | merge | Sim | unsellable/limit | ARTIFACT PENDING |
| `CartReviewState` | review | Sim | required/acknowledged | ARTIFACT PENDING |
| `CheckoutDetailsDraftRequest` | checkout draft | Sim | partial fields | ARTIFACT PENDING |
| `CheckoutDetailsDraftResponse` | checkout draft | Sim | complete/incomplete | ARTIFACT PENDING |
| `CheckoutValidationRequest` | validation | Sim | final | ARTIFACT PENDING |
| `CheckoutValidationResponse` | validation | Sim | success/fieldErrors | ARTIFACT PENDING |
| `BrazilianShippingAddress` | checkout/frete/order | Sim | valid/invalid BR | ARTIFACT PENDING |
| `MaskedFederalTaxId` | Store response | Sim | masked only | ARTIFACT PENDING |
| `ConsentReceipt` | checkout/order evidence | Sim | versioned | ARTIFACT PENDING |
| `ShippingQuoteRequest` | quote | Sim | current/stale | ARTIFACT PENDING |
| `ShippingQuoteResponse` | quote | Sim | multiple/none | ARTIFACT PENDING |
| `ShippingOption` | quote/select | Sim | valid/expired | ARTIFACT PENDING |
| `ShippingSelectionRequest` | selection | Sim | opaque ref | ARTIFACT PENDING |
| `CardPaymentAttemptRequest` | payment start | Sim | no authoritative money | ARTIFACT PENDING |
| `CardPaymentAttemptResponse` | payment start | Sim | sensitive fields | ARTIFACT PENDING |
| `PaymentAttemptStatusRequest` | status | Sim | opaque refs only | ARTIFACT PENDING |
| `PaymentAttemptStatusResponse` | status | Sim | reusable/blocked | ARTIFACT PENDING |
| `PaymentAttemptInvalidationRequest` | invalidation | Sim | valid | ARTIFACT PENDING |
| `PaymentAttemptInvalidationResponse` | invalidation | Sim | first/retry | ARTIFACT PENDING |
| `PaymentConfirmationExchangeRequest` | exchange | Sim | token | ARTIFACT PENDING |
| `PaymentConfirmationExchangeResponse` | exchange | Sim, server-only | session ref | ARTIFACT PENDING |
| `PaymentConfirmationStatusRequest` | polling | Sim | session ref | ARTIFACT PENDING |
| `PaymentConfirmationStatusResponse` | polling | Sim | every public state | ARTIFACT PENDING |
| `ConfirmedOrderItem` | confirmation | Sim | public item | ARTIFACT PENDING |
| `ConfirmedOrderSummary` | confirmation | Sim | masked/minimized | ARTIFACT PENDING |
| `StoreErrorResponse` | all Store errors | Sim | major error families | ARTIFACT PENDING |
| `AuthVerificationState` | verification | Sim | pending/verified/blocked | ARTIFACT PENDING |

---

## 14. Matriz de erros

| Código | Requisitos consumidores | Operações principais | Fixture/teste |
|---|---|---|---|
| `CART_NOT_FOUND` | FE-CART-001/003 | cart get/mutations | stale/deleted cart |
| `CART_ACCESS_DENIED` | FE-CART-002 | cart get/mutations | wrong capability/owner |
| `CART_VERSION_MISMATCH` | FE-CART-005/008 | all versioned mutations | stale `If-Match`, status 412 |
| `CART_REVIEW_REQUIRED` | FE-CART-007, FE-CHK-001 | checkout/payment guards | requiresReview true |
| `VARIANT_NOT_SELLABLE` | FE-CART-003/006 | add/merge | unpublished/invalid variant |
| `INVALID_QUANTITY` | FE-CART-004 | add/update | decimal/negative |
| `QUANTITY_LIMIT_EXCEEDED` | FE-CART-004/006 | add/update/merge | >99 |
| `INVALID_CPF` | FE-CHK-004 | checkout | invalid digits/checksum |
| `FEDERAL_TAX_ID_REQUIRED` | FE-CHK-004 | validation | missing CPF |
| `ZERO_TOTAL_NOT_SUPPORTED` | FE-CHK-002, FE-PAY-004 | validation/payment | total 0 |
| `SHIPPING_ADDRESS_INVALID` | FE-SHP-001 | quote | incomplete invalid BR address |
| `SHIPPING_NOT_AVAILABLE` | FE-SHP-001/004 | quote | no options |
| `SHIPPING_QUOTE_EXPIRED` | FE-SHP-002/003 | select/payment | TTL expired |
| `SHIPPING_OPTION_NO_LONGER_ELIGIBLE` | FE-SHP-002/003 | select | stale option |
| `SHIPPING_PROVIDER_UNAVAILABLE` | FE-SHP-004 | quote | provider failure |
| `SHIPPING_PROVIDER_TIMEOUT` | FE-SHP-004 | quote | provider timeout |
| `PAYMENT_CHECKOUT_INCOMPLETE` | FE-PAY-004 | create attempt | incomplete checkout |
| `PAYMENT_ATTEMPT_ALREADY_ACTIVE` | FE-PAY-004 | create attempt | incompatible active state |
| `PAYMENT_ATTEMPT_INVALIDATED` | FE-PAY-005/006 | status/invalidate | invalidated state |
| `PAYMENT_PROVIDER_UNAVAILABLE` | FE-PAY-001 | create/status | Stripe unavailable |
| `PAYMENT_CARD_DECLINED` | FE-PAY-001/005 | status | provider decline public mapping |
| `PAYMENT_CONFIRMATION_UNKNOWN` | FE-PAY-005, FE-CONF-002 | status | ambiguous timeout |
| `PAYMENT_IN_PROGRESS` | FE-PAY-004/005 | create/status | processing lock |
| `CONFIRMATION_NOT_FOUND` | FE-CONF-001/002/006 | exchange/status/order | invalid/hidden/expired resource |
| `CONFIRMATION_RATE_LIMITED` | FE-CONF-002 | status | 429 + Retry-After |
| `CONFIRMATION_SERVICE_UNAVAILABLE` | FE-CONF-002 | status | 503 sanitized |

---

## 15. Contract test suites obrigatórias

### 15.1 `store-auth.contract.spec`

Deve cobrir:

- schemas nativos e customizados de auth;
- anti-enumeração;
- verificação flexível;
- refresh válido/inválido/revogado;
- reset e revogação após mudança de senha.

### 15.2 `store-cart.contract.spec`

Deve cobrir:

- capability;
- lazy creation;
- idempotência;
- line items;
- limite 1–99;
- ETag/If-Match;
- merge completo/parcial;
- revisão e reconhecimento.

### 15.3 `store-checkout.contract.spec`

Deve cobrir:

- autenticação obrigatória;
- draft;
- validação atômica;
- endereço BR;
- CPF masking;
- consentimentos;
- `fieldErrors`.

### 15.4 `store-shipping.contract.spec`

Deve cobrir:

- quote;
- TTL;
- provider hidden;
- select;
- revogação por mudança;
- falha sem fallback.

### 15.5 `store-payment.contract.spec`

Deve cobrir:

- ausência de amount/currency autoritativos no request;
- `client_secret` marcado sensível;
- tentativa compatível/idempotente;
- status;
- invalidação;
- estados Stripe públicos.

### 15.6 `store-confirmation.contract.spec`

Deve cobrir:

- token uso único;
- idempotent exchange;
- session ref BFF-only;
- polling/rate limit;
- todos os estados públicos;
- `ORDER_CONFIRMED` pós-Order;
- ownership e TTL do resumo;
- ausência de Stripe/provider IDs.

### 15.7 `catalog-revalidation.contract.spec`

Deve cobrir:

- assinatura correta/incorreta;
- timestamp válido/expirado;
- event ID duplicado;
- tags catalog/product;
- payload sanitizado;
- retry.

---

## 16. Fixtures mínimas

A aprovação de mock development exige pelo menos:

```text
catalog/
  products-list-success.json
  product-detail-success.json
  product-not-found.json

cart/
  guest-created.json
  active-authenticated.json
  version-mismatch.json
  merge-success.json
  merge-partial.json
  review-required.json

checkout/
  draft-incomplete.json
  validation-success.json
  validation-field-errors.json
  invalid-cpf.json

shipping/
  quote-success.json
  quote-unavailable.json
  quote-expired.json
  selection-success.json

payment/
  card-attempt-created.json
  card-attempt-reused.json
  attempt-processing.json
  attempt-retry-required.json
  attempt-invalidated.json

confirmation/
  exchange-success.json
  awaiting-provider.json
  processing-webhook.json
  order-confirmed.json
  retry-required.json
  reconciliation-required.json
  session-expired.json
  unknown.json
  confirmed-order-summary.json

auth/
  register-success.json
  login-success.json
  verification-pending.json
  verification-confirmed.json
  reset-request-accepted.json

errors/
  rate-limited.json
  service-unavailable.json
  unauthorized.json
  forbidden.json
```

Fixtures não podem conter secrets reais, CPF real, JWT reutilizável, e-mail pessoal, endereço real ou provider IDs de produção.

---

## 17. Gates de materialização

### GATE-T01 — Documentos

Requer:

- `docs/PRD_frontend_v1.1.md` alinhado;
- `docs/PRD_Backend_v1.1.md` alinhado;
- `docs/SRS_v1.5.md` alinhado;
- este documento criado e sem lacunas `FE-*`.

**Estado:** `PASS` para documentação-base de decisões.

### GATE-T02 — Registry e OpenAPI

Requer:

- todas as operações MUST registradas;
- Store OpenAPI `1.1.0` gerado;
- Webhooks OpenAPI atualizado para revalidação quando aplicável;
- operationIds estáveis;
- schemas mínimos presentes;
- security/headers/unidades corretos.

**Estado:** `PENDING`.

### GATE-T03 — Tipos e Zod

Requer:

- tipos gerados a partir do OpenAPI;
- Zod para todas as respostas críticas;
- equivalência comprovada por teste.

**Estado:** `PENDING`.

### GATE-T04 — Fixtures e mocks

Requer:

- fixtures mínimas da seção 16;
- mock server consumindo fixtures validadas;
- nenhum campo proibido.

**Estado:** `PENDING`.

### GATE-T05 — Contract tests

Requer suites da seção 15 e cobertura de:

- status;
- headers;
- segurança;
- idempotência;
- ETag;
- masking;
- unidades;
- erros;
- ausência de campos proibidos.

**Estado:** `PENDING`.

### GATE-T06 — Gate global

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

Qualquer falha relevante resulta em `BLOCKED`.

**Estado:** `PENDING` até os artefatos existirem.

---

## 18. Critério para PASS PARA MOCK DEVELOPMENT

`PASS PARA MOCK DEVELOPMENT` somente pode ser concedido quando:

- GATE-T01 = PASS;
- GATE-T02 = PASS;
- GATE-T03 = PASS;
- GATE-T04 = PASS;
- contratos possuem versão explícita;
- todos os 54 requisitos FE estão ligados a operação/artefato ou classificados explicitamente como BFF-only/external;
- não existe endpoint-alvo consumido apenas porque foi mencionado em PRD;
- fixtures são validadas contra OpenAPI/Zod;
- nenhuma fixture contém dado sensível proibido.

Contract tests completos podem continuar como gate de integração se a governança aprovar essa separação, mas o mock server não pode nascer de contratos não materializados.

---

## 19. Critério para PASS PARA INTEGRAÇÃO

Além dos gates de mock development:

- GATE-T05 = PASS;
- GATE-T06 = PASS;
- testes HTTP reais comprovam comportamento customizado;
- banco/migrations refletem persistência nova necessária;
- segurança de capability, CPF e confirmation tokens está comprovada;
- idempotência e concorrência estão testadas;
- webhook Stripe continua sendo a única autoridade de criação de Order;
- falhas externas não quebram a verdade transacional;
- domínios/CORS/secrets permanecem sujeitos a gate humano antes de deploy.

---

## 20. Estado consolidado

```text
Gate de Decisões A–J: PASS
Gate de Decisões R: PASS
PRD Frontend alinhado: PASS
PRD Backend alinhado: PASS
SRS alinhado: PASS
Matriz de rastreabilidade criada: PASS
Cobertura FE-* de decisão: 54/54

Registry/OpenAPI 1.1.0: PENDING
Tipos/Zod: PENDING
Fixtures/mocks: PENDING
Contract tests: PENDING
CI/drift global: PENDING

Gate de Artefatos: PENDING
PASS DOCUMENTAL: não concedido
PASS PARA MOCK DEVELOPMENT: não concedido
PASS PARA INTEGRAÇÃO: não concedido
```

---

## 21. Referências canônicas

- `docs/PRD_frontend_v1.1.md`;
- `docs/PRD_Backend_v1.1.md`;
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

*Última revisão: 2026-08-06 — matriz inicial de rastreabilidade criada para cobrir os 54 requisitos do Frontend Milestone 1 e definir as evidências necessárias para materialização dos contratos.*
