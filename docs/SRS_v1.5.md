# SRS — E-commerce Headless Print-on-Demand da Indicio Cult

| Campo | Valor |
|---|---|
| Documento | Software Requirements Specification |
| Projeto | E-commerce headless Print-on-Demand da Indicio Cult |
| Versão | 1.5.1 — reconciliação as-built |
| Data da revisão | 2026-08-03 |
| Status | Canônico — backend v1.0 entregue; storefront não iniciada |
| Mercado inicial | Brasil |
| Moeda | BRL |
| Backend | Medusa v2, Node.js e TypeScript |
| Runtime atual | Heroku (`release`, `web` e `worker`) |
| Persistência | Supabase PostgreSQL |
| Cache e processamento assíncrono | Redis |
| Contratos | OpenAPI 3.1.2 — Store, Admin e Webhooks |

> **Nota da revisão 1.5.1:** esta revisão substitui premissas históricas que não correspondem ao sistema entregue. Estados anteriores ao pagamento permanecem em `Cart`, `PaymentCollection`, `PaymentSession` e `PaymentAttempt`. Um `Order` só é criado após confirmação confiável, validada e idempotente do webhook canônico da Stripe. O backend v1.0 está entregue; a storefront continua planejada, mas não foi iniciada.

> **Autoridade:** quando houver conflito, prevalecem o código versionado, os contratos OpenAPI, `docs/PRD_Backend_v1.1.md`, `docs/DB_MODEL_v1.21.md` e as decisões registradas em `.planning/`.

---

## Sumário

1. [Introdução](#1-introdução)
2. [Escopo e estado de entrega](#2-escopo-e-estado-de-entrega)
3. [Atores e responsabilidades](#3-atores-e-responsabilidades)
4. [Arquitetura do sistema](#4-arquitetura-do-sistema)
5. [Interfaces e contratos](#5-interfaces-e-contratos)
6. [Fluxos de uso](#6-fluxos-de-uso)
7. [Requisitos funcionais](#7-requisitos-funcionais)
8. [Dados e invariantes](#8-dados-e-invariantes)
9. [Estados do sistema](#9-estados-do-sistema)
10. [Requisitos não funcionais](#10-requisitos-não-funcionais)
11. [Segurança e privacidade](#11-segurança-e-privacidade)
12. [Observabilidade e auditoria](#12-observabilidade-e-auditoria)
13. [Integrações externas](#13-integrações-externas)
14. [Testes e gates](#14-testes-e-gates)
15. [Deploy, release e operação](#15-deploy-release-e-operação)
16. [Critérios de aceite e estado atual](#16-critérios-de-aceite-e-estado-atual)
17. [Fora do escopo](#17-fora-do-escopo)
18. [Riscos e limitações](#18-riscos-e-limitações)
19. [Decisões futuras](#19-decisões-futuras)
20. [Rastreabilidade e referências](#20-rastreabilidade-e-referências)

---

## 1. Introdução

### 1.1 Propósito

Este documento especifica requisitos funcionais, técnicos e operacionais para o e-commerce headless Print-on-Demand da Indicio Cult.

O SRS descreve:

- o backend efetivamente entregue no milestone `v1.0`;
- as interfaces que uma storefront futura deverá consumir;
- os invariantes de pagamento, pedido e fulfillment;
- os fluxos administrativos e operacionais;
- os requisitos de segurança, observabilidade, idempotência e operação;
- as limitações externas que ainda não foram comprovadas em uso real.

### 1.2 Valor central

O sistema deve proteger a cadeia financeira e operacional:

> Um `Order` só existe e só pode prosseguir para produção após confirmação confiável, validada e idempotente do pagamento pelo webhook canônico da Stripe.

O sistema deve impedir:

- `Order` sem pagamento confirmado;
- cobrança confirmada sem coordenação idempotente de criação do pedido;
- dois pedidos para o mesmo pagamento;
- fulfillment duplicado;
- envio prematuro à Gelato;
- dependência de PostHog, Resend ou Gelato para preservar a verdade transacional local;
- exposição de credenciais, tokens ou dados pessoais desnecessários.

### 1.3 Terminologia normativa

- **DEVE:** requisito obrigatório.
- **NÃO DEVE:** comportamento proibido.
- **DEVERIA:** requisito recomendado, não bloqueante para o backend v1.0.
- **PODE:** capacidade opcional ou futura.

### 1.4 Estado de implementação

| Estado | Significado |
|---|---|
| Entregue | Implementado e coberto pelos gates aceitos do backend v1.0 |
| Implementado, ativação diferida | Código e contrato existem, mas a ativação externa depende de condição operacional |
| Planejado | Requisito do sistema futuro, ainda não iniciado |
| Fora do escopo | Explicitamente não pertencente ao ciclo atual |

---

## 2. Escopo e estado de entrega

### 2.1 Sistema completo

O sistema completo é composto por:

- storefront headless futura;
- backend Medusa v2;
- Admin Dashboard;
- PostgreSQL via Supabase;
- Supabase Storage;
- Redis;
- Stripe;
- Resend;
- Gelato;
- PostHog;
- Sentry;
- processo operacional de logística reversa dos Correios.

### 2.2 Backend entregue

O backend v1.0 inclui:

- catálogo, produtos, variantes, preços em BRL e publicação;
- imagens públicas via Supabase Storage com interface S3;
- carrinho convidado e autenticado;
- associação segura de carrinho convidado ao cliente autenticado;
- checkout brasileiro;
- `PaymentAttempt` para cartão e Pix;
- ingestão e deduplicação de webhook Stripe;
- criação idempotente e concorrente do `Order` após pagamento confirmado;
- outbox de `purchase_completed`;
- outbox de e-mail transacional;
- elegibilidade e dispatch Gelato;
- webhook Gelato e tracking;
- tracking público por token opaco;
- reembolsos administrativos confirmados por webhook;
- trocas e logística reversa manual/semiautomática;
- alertas operacionais persistidos;
- auditoria administrativa;
- logs estruturados, Sentry e health checks;
- contratos OpenAPI Store, Admin e Webhooks;
- Swagger UI local, protegida e somente leitura;
- runtime Heroku com processos `release`, `web` e `worker`.

### 2.3 Storefront

A storefront permanece **planejada e não iniciada**.

Ela deverá:

- consumir os contratos Store existentes;
- não reimplementar regras financeiras autoritativas;
- confirmar pagamentos diretamente com Stripe.js;
- aguardar o backend para determinar a existência do `Order`;
- respeitar autenticação, publishable API key e contratos monetários;
- tratar estados assíncronos de pagamento e pós-compra.

### 2.4 Limitações externas não bloqueantes

- Pix depende da elegibilidade da conta Stripe;
- envio real pelo Resend não foi comprovado externamente;
- dispatch real para Gelato não foi comprovado externamente;
- entrega real ao PostHog não foi comprovada externamente;
- exercício externo do Sentry não foi comprovado;
- rollback real não foi executado;
- Correios permanece manual/semiautomático.

Essas limitações não reabrem o milestone `v1.0`.

---

## 3. Atores e responsabilidades

| Ator | Responsabilidade |
|---|---|
| Visitante | Consultar catálogo e iniciar carrinho |
| Comprador convidado | Concluir checkout, pagar e acompanhar pedido por token |
| Cliente autenticado | Preservar carrinho, comprar e acessar dados autorizados |
| Operador Admin | Gerenciar catálogo, pedidos, reembolsos, trocas e alertas |
| Stripe | Processar pagamento e emitir eventos financeiros confiáveis |
| Gelato | Produzir, enviar e emitir atualizações de fulfillment |
| Resend | Entregar e-mails transacionais e operacionais |
| PostHog | Receber eventos analíticos sanitizados |
| Sentry | Receber erros sanitizados |
| Worker | Executar jobs assíncronos, retries, relays e scanners |
| Operador técnico | Validar saúde, release, logs, contratos e incidentes |

---

## 4. Arquitetura do sistema

### 4.1 Arquitetura atual

```text
Storefront futura / cliente HTTP
            │
            │ Store API
            ▼
       Heroku web.1
       Medusa Server
            │
            ├── Admin Dashboard em /app
            ├── Store API
            ├── Admin API
            ├── Webhooks Stripe/Gelato
            ├── Swagger UI /docs
            ├── Health /health/live e /health/ready
            │
            ├── Supabase PostgreSQL
            ├── Redis
            ├── Supabase Storage
            └── Sentry

       Heroku worker.1
            │
            ├── Analytics relay → PostHog
            ├── E-mail relay → Resend
            ├── Dispatch/reconciliação → Gelato
            └── Scanners e alertas operacionais

       Heroku release
            └── db:migrate:safe
```

### 4.2 Processos

| Processo | Requisito |
|---|---|
| `release` | DEVE executar migrações seguras antes da formação da nova release |
| `web` | DEVE servir HTTP, Admin, webhooks, health e documentação habilitada |
| `worker` | DEVE executar jobs, retries, dispatch e reconciliações |

### 4.3 Componentes persistentes

| Componente | Responsabilidade |
|---|---|
| `PaymentAttempt` | Tentativa de pagamento, método, valor, estado e vínculo Stripe |
| `WebhookEventLog` | Ingestão, deduplicação e rastreabilidade de webhooks |
| `CheckoutCompletionLog` | Coordenação idempotente e concorrente da criação de `Order` |
| `AnalyticsEventLog` | Outbox de `purchase_completed` |
| `EmailDeliveryLog` | Outbox de e-mail transacional |
| `GelatoFulfillment` | Elegibilidade, dispatch, estado e tracking |
| `TrackingAccessToken` | Capability token armazenado por hash |
| `RefundRequest` | Solicitação e confirmação de reembolso |
| `ExchangeRequest` | Fluxo administrativo de troca |
| `OperationalAlert` | Falhas que exigem intervenção humana |
| `AdminActionLog` | Auditoria de ações administrativas sensíveis |

### 4.4 Separação de responsabilidades

- O processo HTTP NÃO DEVE depender da conclusão de integrações externas lentas para preservar estado local.
- Jobs assíncronos DEVEM ser reprocessáveis.
- Estado financeiro, estado do pedido, estado do fulfillment e estado externo NÃO DEVEM ser comprimidos em um único campo.
- O storefront NÃO DEVE decidir que um pagamento produziu um `Order`.

---

## 5. Interfaces e contratos

### 5.1 Contratos OpenAPI

O sistema mantém três documentos OpenAPI 3.1.2 independentes:

| Superfície | Endpoint quando habilitado | Uso |
|---|---|---|
| Store | `/openapi/store.json` | Storefront e compradores |
| Admin | `/openapi/admin.json` | Operadores autenticados |
| Webhooks | `/openapi/webhooks.json` | Ingressos Stripe e Gelato |

Requisitos:

- os registries TypeScript DEVEM ser a fonte de verdade;
- JSONs gerados DEVEM ser determinísticos e versionados;
- artefatos gerados NÃO DEVEM ser editados manualmente;
- cobertura, metadados, segurança e fingerprints DEVEM passar no gate global;
- cada documento DEVE ser autocontido;
- schemas internos NÃO DEVEM vazar para Store.

### 5.2 Swagger UI

A Swagger UI:

- DEVE usar assets locais e same-origin;
- DEVE operar como documentação somente leitura;
- NÃO DEVE habilitar `Try it out`;
- NÃO DEVE habilitar submissão de métodos HTTP;
- NÃO DEVE persistir autorização;
- NÃO DEVE injetar cookies ou tokens em operações;
- DEVE permanecer desabilitada por padrão em produção;
- DEVE exigir usuário Medusa autenticado para incluir Admin e Webhooks no seletor.

### 5.3 Autenticação

| Superfície | Mecanismo |
|---|---|
| Store pública | Publishable API key nas rotas aplicáveis |
| Store autenticada | JWT ou sessão de cliente, além da publishable API key quando exigida |
| Admin nativo | Sessão, JWT ou API key conforme contrato nativo |
| Admin customizado sensível | Usuário Admin autenticado; atores API key podem ser rejeitados |
| Documentação interna | Usuário autenticado do tipo `user` com `actor_id` válido |
| Stripe webhook | Assinatura Stripe sobre raw body |
| Gelato webhook | Header canônico configurado e segredo correspondente |

### 5.4 Correlation ID

- O sistema DEVE aceitar `x-correlation-id` quando fornecido de forma válida.
- O sistema DEVE retornar correlation ID após a requisição alcançar o middleware correspondente.
- Respostas precoces do framework podem não conter o header e DEVEM ser documentadas quando aplicável.

---

## 6. Fluxos de uso

### 6.1 Catálogo

```text
Cliente consulta produtos
→ Store API aplica conjunto público fechado de campos
→ Backend filtra produtos/variantes não vendáveis
→ Backend retorna mídia, opções, variantes e preço em BRL
→ Metadados internos Gelato não são expostos
```

### 6.2 Carrinho ativo

```text
Cliente chama POST /store/carts/active
→ Backend identifica sessão ou cliente
→ Reutiliza carrinho válido com 200
→ Ou cria carrinho BRL com 201
→ Carrinho permanece estado pré-Order
```

### 6.3 Associação de carrinho convidado

```text
Cliente se autentica
→ Chama POST /store/customers/me/cart/attach
→ Backend valida sessão, cliente e propriedade do carrinho
→ Preserva carrinho válido do cliente quando existente
→ Ou associa o carrinho convidado autorizado
```

O sistema NÃO DEVE permitir anexar carrinho de outra sessão nem substituir silenciosamente um carrinho válido do cliente.

### 6.4 Checkout brasileiro

```text
Cliente informa e-mail, endereço e dados necessários
→ Backend valida país BR e campos obrigatórios
→ CPF/CNPJ completo é processado somente onde necessário
→ Frete, impostos e totais são derivados pelo servidor
→ checkout_data_complete é calculado pelo backend
→ Nenhum Order é criado
```

### 6.5 Pagamento por cartão

```text
Storefront inicia PaymentAttempt de cartão
→ Backend valida carrinho e checkout
→ Backend deriva valor e moeda
→ Stripe cria PaymentIntent
→ Backend retorna client_secret efêmero
→ Storefront confirma com Stripe.js
→ Order ainda não existe
```

### 6.6 Pagamento Pix

```text
Storefront inicia PaymentAttempt Pix
→ Backend valida carrinho e elegibilidade
→ Stripe cria PaymentIntent Pix
→ Backend retorna instruções sensíveis
→ PaymentAttempt permanece pendente
→ Order não existe até webhook canônico de sucesso
```

A capacidade está implementada, mas sua ativação depende da elegibilidade da conta Stripe.

### 6.7 Webhook Stripe e criação do pedido

```text
Stripe envia evento
→ Backend preserva raw body
→ Valida assinatura
→ WebhookEventLog registra ou deduplica
→ Localiza PaymentAttempt e carrinho
→ CheckoutCompletionLog coordena concorrência
→ Cria um único Order
→ Registra purchase_completed
→ Registra intenção de e-mail
→ Cria/elege fulfillment Gelato
→ Retorna sem depender do sucesso externo
```

Evento canônico de sucesso: `payment_intent.succeeded`.

### 6.8 Falha, cancelamento ou expiração do pagamento

```text
Stripe envia evento canônico de falha/cancelamento
→ Evento é registrado idempotentemente
→ PaymentAttempt segue transição permitida
→ Carrinho pode permitir nova tentativa
→ Order não é criado
→ purchase_completed não é registrado
→ Fulfillment não é enviado
```

### 6.9 Analytics

```text
Order confirmado
→ AnalyticsEventLog contém purchase_completed único
→ Worker envia payload sanitizado ao PostHog
→ Sucesso marca entregue
→ Falha agenda retry e observabilidade
```

O dispatch Gelato depende do registro local de `purchase_completed`, não do sucesso no PostHog.

### 6.10 E-mail de confirmação

```text
Order confirmado
→ EmailDeliveryLog registra entrega esperada
→ Worker envia pelo Resend
→ Sucesso marca concluído
→ Falha permanece reprocessável
```

Falha de e-mail NÃO DEVE cancelar ou invalidar pedido pago.

### 6.11 Fulfillment Gelato

```text
Order confirmado + purchase_completed local
→ Backend valida snapshot dos itens
→ Worker reserva dispatch idempotente
→ Envia pedido à Gelato
→ Persiste identificador e status
→ Webhook Gelato atualiza status e tracking
```

### 6.12 Webhook Gelato

```text
Gelato envia evento
→ Backend valida autenticação
→ WebhookEventLog registra ou deduplica
→ Localiza GelatoFulfillment
→ Valida transição
→ Persiste tracking
→ Reconcilia fulfillment e pedido
```

### 6.13 Tracking convidado

```text
Backend gera token opaco
→ Persiste somente hash
→ Cliente envia token no body de POST /store/tracking/lookup
→ Backend valida token e expiração
→ Retorna DTO público reduzido
```

O token NÃO DEVE aparecer em path, query, logs ou exemplos OpenAPI.

### 6.14 Reembolso administrativo

```text
Operador autenticado solicita reembolso
→ Backend valida ator, pedido, valor e idempotency key
→ RefundRequest é criado ou reutilizado
→ Stripe recebe solicitação
→ Estado local permanece pendente
→ Webhook Stripe confirma financeiramente
→ Estado financeiro é recalculado
→ AdminActionLog registra ação
```

Reembolso NÃO DEVE alterar automaticamente `order_status` para `canceled`.

### 6.15 Troca e logística reversa

```text
Operador cria ExchangeRequest
→ Backend valida ator, pedido, motivo e itens
→ Define responsabilidade do frete
→ Operador registra referências dos Correios obtidas externamente
→ Status segue grafo permitido
→ Histórico e auditoria são preservados
```

### 6.16 Alertas operacionais

```text
Scanner detecta pagamento travado ou fulfillment falho
→ OperationalAlert é criado ou agregado
→ Contagem e timestamps são atualizados
→ Operador consulta no Admin
→ Reconhece, resolve ou ignora
→ Ações sensíveis são auditadas
```

### 6.17 Health checks

```text
GET /health/live
→ confirma que o processo HTTP responde

GET /health/ready
→ testa PostgreSQL e Redis em paralelo
→ retorna 200 quando prontos
→ retorna 503 sanitizado quando alguma dependência falha
```

---

## 7. Requisitos funcionais

### 7.1 Catálogo e mídia

| ID | Requisito | Estado | Critério de aceite |
|---|---|---|---|
| SRS-BE-CAT-001 | O Admin DEVE gerenciar produtos, variantes, preços e publicação | Entregue | CRUD e publicação disponíveis no Admin |
| SRS-BE-CAT-002 | A Store API DEVE expor somente variantes vendáveis | Entregue | Variante sem elegibilidade não aparece como vendável |
| SRS-BE-CAT-003 | O backend DEVE exigir metadados Gelato para elegibilidade | Entregue | Falta de metadados bloqueia venda/fulfillment conforme o gate aplicável |
| SRS-BE-CAT-004 | Imagens DEVEM ser servidas por Supabase Storage | Entregue | URLs públicas autorizadas aparecem no catálogo |
| SRS-BE-CAT-005 | Itens do pedido DEVEM preservar snapshot operacional | Entregue | Mudança posterior do catálogo não altera payload do pedido confirmado |

### 7.2 Carrinho e cliente

| ID | Requisito | Estado | Critério de aceite |
|---|---|---|---|
| SRS-BE-CART-001 | O sistema DEVE criar ou recuperar carrinho ativo | Entregue | `POST /store/carts/active` retorna 200 ou 201 |
| SRS-BE-CART-002 | O carrinho DEVE funcionar para convidado e autenticado | Entregue | Ator autorizado recupera seu carrinho ativo |
| SRS-BE-CART-003 | O sistema DEVE associar carrinho convidado com verificação de propriedade | Entregue | Carrinho de outra sessão é rejeitado |
| SRS-BE-CART-004 | O sistema DEVE preservar carrinho válido do cliente | Entregue | Attach não substitui silenciosamente carrinho existente |
| SRS-BE-CART-005 | O DTO público DEVE minimizar dados pessoais | Entregue | CPF/CNPJ completo não é retornado |

### 7.3 Checkout

| ID | Requisito | Estado | Critério de aceite |
|---|---|---|---|
| SRS-BE-CHK-001 | Checkout DEVE aceitar somente endereço brasileiro no MVP | Entregue | `country_code` fora de BR é rejeitado |
| SRS-BE-CHK-002 | Completude do checkout DEVE ser derivada pelo servidor | Entregue | `checkout_data_complete` não é controlado pelo cliente |
| SRS-BE-CHK-003 | Totais DEVEM ser derivados de dados persistidos | Entregue | Campos monetários enviados pelo cliente não são autoridade |
| SRS-BE-CHK-004 | Estado pré-pagamento NÃO DEVE criar `Order` | Entregue | Carrinho e PaymentAttempt existem sem Order |
| SRS-BE-CHK-005 | Frete e totais DEVEM ser calculados antes da tentativa de pagamento | Entregue | PaymentAttempt exige carrinho elegível/completo |

### 7.4 Pagamento e pedido

| ID | Requisito | Estado | Critério de aceite |
|---|---|---|---|
| SRS-BE-PAY-001 | O backend DEVE iniciar cartão por `PaymentAttempt` | Entregue | Retorna `client_secret` efêmero e estado documentado |
| SRS-BE-PAY-002 | O backend DEVE iniciar Pix por `PaymentAttempt` | Implementado, ativação diferida | Contrato existe; ativação depende da conta Stripe |
| SRS-BE-PAY-003 | O webhook Stripe DEVE validar assinatura sobre raw body | Entregue | Assinatura inválida não altera estado |
| SRS-BE-PAY-004 | Webhooks DEVEM ser deduplicados | Entregue | Reentrega não repete efeitos |
| SRS-BE-PAY-005 | `Order` DEVE ser criado somente após sucesso canônico | Entregue | Não existe Order antes de `payment_intent.succeeded` |
| SRS-BE-PAY-006 | Concorrência NÃO DEVE criar dois pedidos | Entregue | Um pagamento produz no máximo um Order |
| SRS-BE-PAY-007 | Falha/cancelamento/expiração NÃO DEVE criar Order | Entregue | Nenhum downstream de compra é iniciado |
| SRS-BE-PAY-008 | Estado financeiro e estado do pedido DEVEM permanecer separados | Entregue | Reembolso não cancela automaticamente o pedido |

### 7.5 Downstream

| ID | Requisito | Estado | Critério de aceite |
|---|---|---|---|
| SRS-BE-DWN-001 | `purchase_completed` DEVE ser registrado localmente uma única vez | Entregue | Outbox idempotente por pedido |
| SRS-BE-DWN-002 | Analytics DEVE ser entregue assincronamente | Entregue | Falha gera retry sem bloquear Gelato |
| SRS-BE-DWN-003 | E-mail DEVE ser entregue assincronamente | Entregue | Falha permanece reprocessável |
| SRS-BE-DWN-004 | Gelato DEVE receber somente pedido localmente elegível | Entregue | Dispatch exige Order confirmado e pré-condições persistidas |
| SRS-BE-DWN-005 | Dispatch Gelato DEVE ser idempotente | Entregue | Não há múltiplos pedidos externos ativos indevidos |
| SRS-BE-DWN-006 | Webhook Gelato DEVE atualizar estados e tracking idempotentemente | Entregue | Duplicatas não repetem efeitos |

### 7.6 Tracking

| ID | Requisito | Estado | Critério de aceite |
|---|---|---|---|
| SRS-BE-TRK-001 | Tracking convidado DEVE usar token opaco | Entregue | Token não contém identificador previsível |
| SRS-BE-TRK-002 | Somente hash do token DEVE ser persistido | Entregue | Token puro não está no banco |
| SRS-BE-TRK-003 | Lookup DEVE receber token no body | Entregue | Token não aparece em URL |
| SRS-BE-TRK-004 | Resposta pública DEVE ser reduzida | Entregue | Não expõe endereço, e-mail ou identificador fiscal |

### 7.7 Admin, reembolsos, trocas e alertas

| ID | Requisito | Estado | Critério de aceite |
|---|---|---|---|
| SRS-BE-ADM-001 | Ações sensíveis DEVEM exigir usuário Admin autenticado | Entregue | Ator inválido/API key é rejeitado onde previsto |
| SRS-BE-ADM-002 | Identidade do operador NÃO DEVE vir do body | Entregue | Ator é obtido do contexto autenticado |
| SRS-BE-ADM-003 | Reembolso DEVE validar valor disponível e idempotência | Entregue | Solicitação duplicada reutiliza estado seguro |
| SRS-BE-ADM-004 | Reembolso DEVE ser confirmado por webhook Stripe | Entregue | Estado financeiro final não depende da resposta síncrona |
| SRS-BE-ADM-005 | Troca DEVE manter grafo de estados e histórico | Entregue | Transições inválidas são rejeitadas |
| SRS-BE-ADM-006 | Correios DEVE operar manual/semiautomaticamente | Entregue | Operador registra código, prazo e referências |
| SRS-BE-ADM-007 | Alertas DEVEM ser persistidos e consultáveis | Entregue | Lista/detalhe retornam DTO sanitizado |
| SRS-BE-ADM-008 | Ações administrativas críticas DEVEM ser auditadas | Entregue | `AdminActionLog` contém ator e fatos sanitizados |

### 7.8 Documentação de API

| ID | Requisito | Estado | Critério de aceite |
|---|---|---|---|
| SRS-BE-DOC-001 | Store, Admin e Webhooks DEVEM ter contratos separados | Entregue | Três documentos OpenAPI independentes |
| SRS-BE-DOC-002 | Geração DEVE ser determinística | Entregue | `openapi:check` sem drift |
| SRS-BE-DOC-003 | Swagger DEVE ser não interativo | Entregue | Métodos de submissão desabilitados |
| SRS-BE-DOC-004 | Produção DEVE manter docs desabilitadas por padrão | Entregue | Flags padrão impedem exposição |
| SRS-BE-DOC-005 | Contratos internos DEVEM exigir autenticação de usuário | Entregue | Admin/Webhooks não são expostos ao ator não autenticado |

### 7.9 Storefront futura

| ID | Requisito | Estado | Critério de aceite futuro |
|---|---|---|---|
| SRS-SF-001 | A storefront DEVE listar produtos publicados | Planejado | Consome Store API e exibe preço/variantes |
| SRS-SF-002 | A storefront DEVE gerenciar carrinho ativo | Planejado | Cria, recupera e atualiza carrinho autorizado |
| SRS-SF-003 | A storefront DEVE suportar checkout convidado e autenticado | Planejado | Jornada funciona sem criar Order antecipado |
| SRS-SF-004 | A storefront DEVE confirmar cartão com Stripe.js | Planejado | Dados de cartão não passam pelo backend |
| SRS-SF-005 | A storefront DEVE tratar Pix como capacidade condicionada | Planejado | UI respeita ativação operacional da conta |
| SRS-SF-006 | A storefront DEVE aguardar confirmação assíncrona do Order | Planejado | Não assume sucesso apenas pelo retorno do cliente |
| SRS-SF-007 | A storefront DEVE permitir tracking por token | Planejado | Token é enviado no body do lookup |
| SRS-SF-008 | A storefront DEVE incluir páginas legais e política de trocas | Planejado | Conteúdo disponível antes da compra |

---

## 8. Dados e invariantes

### 8.1 Entidades pré-pagamento

Antes da confirmação canônica, o estado deve residir em:

- `Cart`;
- `PaymentCollection`;
- `PaymentSession`;
- `PaymentAttempt`.

`Order` NÃO DEVE representar intenção de compra pendente.

### 8.2 Idempotência

| Operação | Chave/coordenação |
|---|---|
| Webhook Stripe | ID externo ou chave de deduplicação persistida |
| Criação de Order | pagamento/carrinho coordenado por `CheckoutCompletionLog` |
| `purchase_completed` | chave única por pedido |
| E-mail transacional | pedido + tipo de e-mail |
| Dispatch Gelato | pedido/fulfillment com reserva persistida |
| Webhook Gelato | ID externo ou hash de payload quando necessário |
| Reembolso | `idempotency_key` validada no domínio |
| Alerta operacional | tipo + entidade + chave de agregação |

### 8.3 Webhook sem ID externo

Quando `external_event_id` não existir, o sistema DEVE deduplicar por chave estável derivada de provider e hash do payload ou mecanismo equivalente.

### 8.4 Unidades monetárias

- Store pública pode usar BRL em unidade maior conforme schema.
- PaymentAttempt e operações Admin sensíveis podem usar BRL em unidade menor.
- Cada contrato DEVE declarar a unidade monetária.
- Conversões DEVEM ocorrer em fronteiras explícitas e testadas.
- `Payment.amount` NÃO DEVE ser negativo.
- `captured_amount` NÃO DEVE exceder `amount`.
- `Refund.amount` DEVE ser maior que zero.
- A moeda do MVP DEVE ser BRL.

### 8.5 Snapshot operacional

Os dados necessários ao fulfillment DEVEM ser preservados no contexto do pedido. Alterações posteriores no produto ou variante NÃO DEVEM modificar o payload de um pedido já confirmado.

---

## 9. Estados do sistema

### 9.1 Pagamento

Os estados detalhados pertencem a `PaymentAttempt` e aos objetos Medusa/Stripe associados.

Invariantes:

- sucesso canônico produz no máximo um `Order`;
- falha, cancelamento ou expiração não produz `Order`;
- confirmação do cliente não substitui webhook confiável;
- reembolso só é final após evento confiável.

### 9.2 Pedido

O pedido pode refletir estados como:

- `confirmed`;
- `in_fulfillment`;
- `shipped`;
- `delivered`;
- `completed`;
- `canceled`;
- `requires_attention`.

Regras:

- `shipped` NÃO equivale automaticamente a `completed`;
- reembolso NÃO equivale automaticamente a `canceled`;
- falha de e-mail ou analytics NÃO invalida pagamento;
- falha de Gelato pode gerar `requires_attention`;
- estados NÃO DEVEM regredir sem regra explícita.

### 9.3 Fulfillment Gelato

O estado local DEVE representar:

- elegibilidade;
- reserva de dispatch;
- dispatch enviado;
- processamento externo;
- envio/tracking;
- falha recuperável ou permanente;
- reconciliação.

### 9.4 Troca

O fluxo DEVE suportar estados equivalentes a:

- `requested`;
- `approved`;
- `awaiting_posting`;
- `posted`;
- `received`;
- `completed`;
- `rejected`;
- `canceled`.

Transições terminais ou inválidas DEVEM ser rejeitadas.

### 9.5 Alerta operacional

Status suportados:

- `open`;
- `acknowledged`;
- `resolved`;
- `ignored`.

---

## 10. Requisitos não funcionais

| ID | Requisito |
|---|---|
| SRS-NFR-001 | O sistema DEVE usar TypeScript no código de aplicação |
| SRS-NFR-002 | Processos `web` e `worker` DEVEM ser separados |
| SRS-NFR-003 | Operações longas DEVEM ser assíncronas |
| SRS-NFR-004 | Webhooks DEVEM responder sem aguardar relays externos desnecessários |
| SRS-NFR-005 | PostgreSQL e Redis DEVEM possuir health checks sanitizados |
| SRS-NFR-006 | Falhas temporárias DEVEM ser reprocessáveis |
| SRS-NFR-007 | Webhooks e efeitos críticos DEVEM ser idempotentes |
| SRS-NFR-008 | Criação de Order DEVE ser segura sob concorrência |
| SRS-NFR-009 | Logs de produção DEVEM ser estruturados em JSON |
| SRS-NFR-010 | Cada requisição aplicável DEVE possuir correlation ID |
| SRS-NFR-011 | CORS DEVE aceitar somente origens autorizadas |
| SRS-NFR-012 | Secrets DEVEM permanecer fora do repositório |
| SRS-NFR-013 | Migrações DEVEM ser versionadas e executadas no processo `release` |
| SRS-NFR-014 | Contratos OpenAPI DEVEM ser verificados contra drift |
| SRS-NFR-015 | O runtime DEVE expor identidade de versão verificável |

---

## 11. Segurança e privacidade

### 11.1 Dados proibidos em logs

O sistema NÃO DEVE registrar por padrão:

- bodies completos;
- dados de cartão;
- `client_secret`;
- QR ou copia-e-cola Pix;
- cookies;
- `Authorization`;
- tokens de tracking;
- secrets de webhook;
- payloads crus de provider;
- CPF/CNPJ completo;
- endereço completo sem necessidade operacional explícita.

### 11.2 Allowlist

Logs, alertas, auditoria e DTOs internos DEVEM usar allowlist de campos seguros. Objetos arbitrários ou metadados não validados NÃO DEVEM ser expostos.

### 11.3 Tracking

- token DEVE ser imprevisível;
- somente hash DEVE ser persistido;
- token DEVE possuir expiração;
- erro de token inválido DEVE evitar enumeração útil;
- resposta DEVE conter somente dados mínimos.

### 11.4 Identidade administrativa

- ator DEVE ser obtido do contexto de autenticação;
- body NÃO DEVE definir `actor_id`, `admin_id`, e-mail do operador ou identidade equivalente;
- ações sensíveis DEVEM rejeitar ator inadequado.

### 11.5 Sentry e PostHog

- Sentry DEVE operar com scrubbing e `sendDefaultPii=false` ou configuração equivalente;
- PostHog NÃO DEVE receber dados pessoais desnecessários;
- `purchase_completed` DEVE usar identificador analítico seguro;
- falha externa NÃO DEVE comprometer o estado transacional.

---

## 12. Observabilidade e auditoria

### 12.1 Eventos mínimos

O sistema DEVE produzir observabilidade para:

- criação/recuperação de carrinho;
- atualização de checkout;
- início de PaymentAttempt;
- ingestão e deduplicação de webhook;
- criação ou reutilização de `Order`;
- registro de `purchase_completed`;
- relay ou retry de analytics e e-mail;
- elegibilidade e dispatch Gelato;
- webhook Gelato e tracking;
- solicitação e confirmação de reembolso;
- criação e transição de troca;
- criação, agregação e resolução de alerta;
- falhas de PostgreSQL, Redis e integrações.

### 12.2 OperationalAlert

Alertas DEVEM:

- usar tipos e severidades controlados;
- possuir entidade e identificador seguros;
- agregar ocorrências equivalentes;
- preservar primeiro e último timestamp;
- permitir reconhecimento, resolução e descarte;
- expor somente metadados sanitizados.

### 12.3 AdminActionLog

A auditoria DEVE preservar:

- ator autenticado;
- tipo de ação;
- entidade afetada;
- timestamp;
- correlation ID quando aplicável;
- fatos mínimos e sanitizados.

### 12.4 Health

`/health/live` DEVE indicar processo vivo.

`/health/ready` DEVE:

- consultar PostgreSQL e Redis em paralelo;
- aplicar timeout;
- retornar `200` quando ambos estiverem disponíveis;
- retornar `503` quando uma dependência obrigatória falhar;
- não gerar Sentry por falha esperada de dependência, salvo regra operacional explícita.

---

## 13. Integrações externas

### 13.1 Stripe

- DEVE ser o provedor de cartão do MVP.
- Pix PODE ser ativado quando a conta estiver elegível.
- Dados sensíveis de cartão DEVEM permanecer no Stripe.
- Webhook DEVE ser a autoridade financeira canônica.
- Reembolso DEVE ser confirmado por webhook.

### 13.2 Gelato

- DEVE ser o único fornecedor POD do MVP.
- Dispatch DEVE usar snapshot estável do pedido.
- Falha temporária DEVE ser reprocessável.
- Falha persistente DEVE gerar alerta.
- Webhook DEVE ser autenticado e idempotente.

### 13.3 Resend

- E-mails DEVEM ser registrados em outbox antes da entrega externa.
- Falha NÃO DEVE invalidar pedido pago.
- Entregas DEVEM ser reprocessáveis.

### 13.4 PostHog

- `purchase_completed` DEVE ser originado pelo backend.
- Evento DEVE ser único por pedido.
- Entrega DEVE ser assíncrona.
- Falha NÃO DEVE bloquear Gelato.

### 13.5 Supabase

- PostgreSQL DEVE ser a persistência transacional.
- Runtime e migrações DEVEM usar contratos de conexão apropriados.
- Supabase Storage DEVE servir mídia pública autorizada.

### 13.6 Redis

O sistema DEVE suportar contratos separados para:

- cache;
- event bus;
- workflows;
- locking.

As URLs podem apontar para a mesma instância, mas as responsabilidades DEVEM permanecer explícitas.

### 13.7 Correios

A integração automática com API dos Correios está fora do MVP. O operador DEVE registrar manual ou semiautomaticamente códigos, prazos e instruções obtidos externamente.

---

## 14. Testes e gates

### 14.1 Estratégia

A validação DEVE incluir:

- testes unitários de módulos, workflows, validadores e segurança;
- integração HTTP real de Store, Admin, health e webhooks;
- integração de módulos Medusa;
- PostgreSQL descartável para constraints, locks e concorrência;
- invariantes pagamento → webhook → `Order` → downstream;
- reentrega e concorrência de webhooks;
- outboxes e retries;
- contratos OpenAPI;
- lint e build;
- validação de release, health e identidade de versão.

### 14.2 Gates OpenAPI

```bash
npm run openapi:verify:store
npm run openapi:verify:admin
npm run openapi:verify:webhooks
npm run openapi:lint
npm run openapi:check
```

`openapi:check` DEVE ser read-only, gerar documentos em memória, comparar bytes e verificar cobertura, metadados, segurança e fingerprints.

### 14.3 Invariantes críticos testáveis

- nenhum `Order` antes do webhook canônico;
- um pagamento produz no máximo um `Order`;
- webhook duplicado não duplica efeitos;
- falha/cancelamento não cria pedido;
- `purchase_completed` é único;
- falha no PostHog não bloqueia Gelato;
- falha de e-mail não cancela pedido;
- Gelato não recebe pedido inelegível;
- tracking não expõe token ou PII;
- reembolso não é confirmado pela resposta síncrona;
- ator Admin não é aceito do body;
- logs não contêm dados proibidos.

---

## 15. Deploy, release e operação

### 15.1 Ambientes

| Ambiente | Estado |
|---|---|
| Local | Disponível para desenvolvimento com PostgreSQL e Redis |
| Produção | Heroku + Supabase PostgreSQL + Redis |
| Staging | Convenção documentada; não provisionado formalmente |

### 15.2 Release atual

- tag anotada: `v1.0`;
- GitHub Release: `v1.0 — Backend MVP`;
- runtime validado: Heroku;
- processos: `release`, `web`, `worker`;
- health: `/health/live` e `/health/ready`;
- Swagger/OpenAPI: desabilitados por padrão em produção.

### 15.3 Processo de deploy

O deploy DEVE:

1. selecionar explicitamente o candidate SHA;
2. executar `db:migrate:safe` no processo `release`;
3. iniciar `web` e `worker`;
4. validar health, PostgreSQL, Redis e versão;
5. executar somente smokes autorizados;
6. preservar evidências sanitizadas;
7. parar em gates manuais quando exigido.

### 15.4 Rollback

- alvo DEVE ser a release anterior compatível registrada antes do deploy;
- rollback real DEVE exigir autorização humana;
- o fechamento do milestone não afirma que rollback real foi executado.

### 15.5 Governança

- execução de fases é manual-review gated;
- nenhum novo milestone ou frontend DEVE iniciar automaticamente;
- alteração de contratos DEVE atualizar registry, testes e artefatos OpenAPI;
- alteração de comportamento de produto DEVE atualizar PRD e SRS.

---

## 16. Critérios de aceite e estado atual

### 16.1 Backend

O backend é considerado entregue quando:

- catálogo e mídia operam em BRL;
- carrinho convidado e autenticado funcionam;
- checkout brasileiro é validado;
- `Order` não existe antes do webhook Stripe;
- criação de pedido é idempotente sob reentrega e concorrência;
- `purchase_completed` é persistido localmente;
- e-mail e analytics usam outboxes reprocessáveis;
- Gelato só recebe pedido elegível;
- tracking convidado usa token seguro;
- reembolso depende de webhook;
- trocas e logística reversa são auditáveis;
- alertas podem ser consultados e tratados;
- logs e Sentry não expõem dados sensíveis;
- health representa PostgreSQL e Redis;
- contratos OpenAPI são completos, determinísticos e protegidos;
- processos `web` e `worker` permanecem ativos;
- release e versão são verificáveis.

Esses critérios foram atendidos no milestone `v1.0`, respeitadas as limitações externas registradas.

### 16.2 Storefront

A storefront NÃO está aceita nem iniciada. Seu aceite será definido em milestone posterior e não pode ser inferido pelo fechamento do backend.

### 16.3 Estado consolidado

| Área | Estado |
|---|---|
| Backend MVP | Entregue, fechado, arquivado, versionado e publicado |
| API Docs | Implementada e fechada documentariamente |
| Runtime Heroku | Validado no fechamento do milestone |
| Storefront | Não iniciada |
| Próximo milestone | Não definido |

---

## 17. Fora do escopo

- estoque físico;
- produção própria;
- múltiplos fornecedores POD;
- editor visual de camiseta;
- upload de arte pelo cliente;
- venda internacional;
- multi-moeda;
- ERP;
- marketplace;
- integração automática com API dos Correios;
- automação completa de troca pelo cliente;
- métodos de pagamento além de cartão e Pix;
- execução de operações pela Swagger UI;
- início automático da storefront.

---

## 18. Riscos e limitações

| Risco/limitação | Tratamento atual |
|---|---|
| Elegibilidade Pix | Ativação diferida até liberação da conta Stripe |
| Falha PostHog | Outbox e retry; não bloqueia Gelato |
| Falha Resend | Outbox e retry; não cancela pedido |
| Falha Gelato | Retry, reconciliação e OperationalAlert |
| Reentrega de webhook | Deduplicação persistida |
| Concorrência de checkout | `CheckoutCompletionLog`, locks e constraints |
| Exposição de PII | DTOs reduzidos, masking, allowlist e scrubbing |
| Drift de documentação | Geração determinística e gate global OpenAPI |
| Dependência de Heroku | Blueprint portável permanece referência, mas runtime atual é Heroku |
| Rollback não exercitado | Processo documentado e sujeito a gate humano |
| Integrações reais não provadas | Classificadas como limitações não bloqueantes do v1.0 |

---

## 19. Decisões futuras

Dependem de decisão humana em novo milestone:

- escopo exato da storefront;
- hospedagem e domínios finais da storefront;
- ativação operacional de Pix;
- prova externa controlada de Resend, Gelato, PostHog e Sentry;
- eventual ambiente de staging;
- automação futura dos Correios;
- política detalhada de consentimento e páginas legais;
- evolução de busca, categorias, promoções e experiência de conta;
- estratégia de compatibilidade para futuras mudanças de API.

Nenhuma dessas decisões autoriza execução automática.

---

## 20. Rastreabilidade e referências

### 20.1 Referências canônicas

- `docs/PRD_Backend_v1.1.md` — produto backend as-built;
- `docs/DB_MODEL_v1.21.md` — modelo de dados;
- `.planning/PROJECT.md` — valor central e decisões;
- `.planning/STATE.md` — estado e governança;
- `docs/openapi/README.md` — manutenção dos contratos;
- `ops/API_DOCS.md` — exposição e segurança da documentação;
- `apps/backend/src/api-docs/generated/store.openapi.json`;
- `apps/backend/src/api-docs/generated/admin.openapi.json`;
- `apps/backend/src/api-docs/generated/webhooks.openapi.json`;
- `apps/backend/.env.template` — contrato de ambiente;
- `Procfile` — topologia Heroku.

### 20.2 Correspondência PRD → SRS

| PRD Backend | Seção SRS |
|---|---|
| Objetivos e escopo | §§1–2 |
| Arquitetura | §4 |
| Contratos e autenticação | §5 |
| Fluxos de uso | §6 |
| Requisitos consolidados | §7 |
| Estados, dinheiro e invariantes | §§8–9 |
| Não funcionais e segurança | §§10–11 |
| Observabilidade | §12 |
| Integrações | §13 |
| Testes e gates | §14 |
| Release e operação | §15 |
| Critérios de aceite | §16 |
| Limitações e próximos passos | §§18–19 |

---

*Última revisão: 2026-08-03 — SRS reconciliado com o backend v1.0 entregue, o PRD Backend as-built, o runtime Heroku, os contratos OpenAPI e o bloqueio formal da storefront até decisão humana sobre o próximo milestone.*