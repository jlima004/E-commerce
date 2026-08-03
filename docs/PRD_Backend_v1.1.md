# PRD — Backend E-commerce POD da Indicio Cult

| Campo | Valor |
|---|---|
| Documento | Product Requirements Document — Backend |
| Projeto | E-commerce headless Print-on-Demand da Indicio Cult |
| Versão | 1.1 — revisão as-built |
| Data da revisão | 2026-08-03 |
| Status | Canônico — backend MVP entregue |
| Responsável | Jefferson |
| Mercado inicial | Brasil |
| Moeda | BRL |
| Runtime atual | Heroku (`release`, `web` e `worker`) |
| Persistência | Supabase PostgreSQL |
| Cache e processamento assíncrono | Redis |
| Integrações | Stripe, Resend, Gelato, PostHog, Sentry e Supabase Storage |
| Contratos de API | OpenAPI 3.1.2 — Store, Admin e Webhooks |

> **Autoridade deste documento:** esta revisão descreve o comportamento efetivamente entregue no milestone `v1.0`. Quando houver conflito com redações históricas, prevalecem o código versionado, os contratos OpenAPI, o modelo de dados vigente e as decisões registradas em `.planning/`.

---

## 1. Resumo executivo

O backend da Indicio Cult é uma plataforma headless para comércio eletrônico Print-on-Demand no Brasil. Ele concentra as regras de catálogo, carrinho, checkout, pagamento, criação de pedidos, fulfillment, tracking, reembolsos, trocas, auditoria e observabilidade.

O valor central do produto é proteger a cadeia financeira e operacional:

> Um `Order` só existe após confirmação confiável, validada e idempotente do pagamento pelo webhook canônico da Stripe. A Gelato só recebe um pedido após o `Order` confirmado e os registros locais obrigatórios terem sido persistidos.

Essa regra evita:

- cobrança confirmada sem pedido;
- pedido sem pagamento confirmado;
- criação duplicada de `Order` por reentrega de webhook;
- fulfillment duplicado;
- envio prematuro à produção;
- dependência indevida de serviços externos para preservar a verdade transacional.

O milestone `v1.0 Backend MVP` está completo, fechado, arquivado, versionado e publicado. O storefront ainda não foi iniciado e deve consumir os contratos estáveis expostos pela Store API.

---

## 2. Objetivos do produto

### 2.1 Objetivos principais

1. Expor uma API estável para uma storefront futura.
2. Permitir operação interna pelo Admin Medusa.
3. Garantir que estados pré-pagamento permaneçam em `Cart`, `PaymentCollection`, `PaymentSession` e `PaymentAttempt`.
4. Criar `Order` somente após o evento Stripe canônico de sucesso.
5. Tornar webhooks e efeitos downstream idempotentes e reprocessáveis.
6. Separar a verdade transacional da entrega a PostHog, Resend e Gelato.
7. Permitir tracking seguro para compradores convidados.
8. Permitir reembolsos e trocas por fluxos administrativos auditáveis.
9. Operar com processos HTTP e worker separados.
10. Disponibilizar contratos OpenAPI determinísticos e documentação Swagger somente leitura.

### 2.2 Métricas de sucesso

- zero `Order` criado sem pagamento canônico confirmado;
- zero duplicidade de `Order` para o mesmo pagamento;
- zero dispatch Gelato antes da elegibilidade local;
- webhooks duplicados sem efeitos colaterais duplicados;
- recuperação operacional possível após falhas temporárias;
- health checks representando corretamente processo, PostgreSQL e Redis;
- contratos Store, Admin e Webhooks sem drift em relação ao runtime.

---

## 3. Escopo entregue

### 3.1 Incluído no backend MVP

- Medusa v2 com Node.js e TypeScript;
- catálogo com produtos, variantes, preços em BRL e metadados Gelato;
- imagens públicas por Supabase Storage via interface S3;
- carrinho convidado e autenticado;
- associação segura de carrinho convidado a cliente autenticado;
- checkout brasileiro com dados e endereço necessários;
- `PaymentAttempt` para tentativas de cartão e Pix;
- Stripe em modo de teste para iniciação controlada;
- webhook Stripe com raw body, assinatura e idempotência;
- criação pós-webhook e concorrente do `Order`;
- `AnalyticsEventLog` para `purchase_completed`;
- `EmailDeliveryLog` para confirmação transacional;
- `GelatoFulfillment` para elegibilidade, dispatch e reconciliação;
- webhook Gelato;
- tracking público por token opaco armazenado somente como hash;
- solicitação de reembolso no Admin e confirmação por webhook Stripe;
- trocas operacionais e logística reversa manual/semiautomática;
- alertas operacionais persistidos;
- auditoria de ações administrativas sensíveis;
- logs estruturados, Sentry e health checks;
- contratos OpenAPI 3.1.2 de Store, Admin e Webhooks;
- Swagger UI local, protegido e não interativo;
- runtime Heroku com processos `release`, `web` e `worker`.

### 3.2 Fora do escopo atual

- storefront/frontend;
- estoque físico ou produção própria;
- múltiplos fornecedores POD;
- editor visual e upload de arte pelo cliente;
- venda internacional e multi-moeda;
- integração automática com API dos Correios;
- ERP ou marketplace;
- automação integral de trocas pelo cliente;
- métodos de pagamento além de cartão e Pix;
- execução interativa de operações pela Swagger UI.

### 3.3 Limitações operacionais não bloqueantes

- Pix depende da elegibilidade da conta Stripe;
- envio real pelo Resend ainda não foi comprovado externamente;
- dispatch real para Gelato ainda não foi comprovado externamente;
- evento real no PostHog ainda não foi comprovado externamente;
- exercício externo do Sentry ainda não foi comprovado;
- rollback real não foi executado;
- Correios permanece manual/semiautomático.

Essas limitações não reabrem o milestone `v1.0`.

---

## 4. Usuários e papéis

| Papel | Necessidade | Superfície principal |
|---|---|---|
| Comprador convidado | Navegar, montar carrinho, pagar e acompanhar pedido | Store API + token de tracking |
| Cliente autenticado | Preservar carrinho, comprar e acessar dados autorizados | Store API + JWT ou sessão |
| Operador Admin | Gerenciar catálogo, pedidos, reembolsos, trocas e alertas | Admin Dashboard + Admin API |
| Stripe | Confirmar estados financeiros por webhook confiável | Webhook Stripe |
| Gelato | Receber pedidos elegíveis e reportar estados | API Gelato + webhook Gelato |
| Worker | Executar relays, retries, dispatch e scanners | Processo `worker` |
| Operador técnico | Validar saúde, logs, contratos e release | Health, logs, Sentry, OpenAPI |

---

## 5. Arquitetura atual

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
            └── db:migrate:safe antes da nova formação
```

### 5.1 Componentes persistentes

| Componente | Responsabilidade |
|---|---|
| `PaymentAttempt` | Tentativa de pagamento, método, valores, status e vínculo com Stripe |
| `WebhookEventLog` | Ingestão, deduplicação e rastreabilidade de webhooks |
| `CheckoutCompletionLog` | Coordenação idempotente e concorrente da criação do `Order` |
| `AnalyticsEventLog` | Outbox durável de `purchase_completed` |
| `EmailDeliveryLog` | Outbox durável de e-mails transacionais |
| `GelatoFulfillment` | Elegibilidade, dispatch, status e tracking da produção |
| `TrackingAccessToken` | Capability token armazenado por hash |
| `RefundRequest` | Solicitação e confirmação de reembolso |
| `ExchangeRequest` | Fluxo administrativo de troca |
| `OperationalAlert` | Falhas que exigem intervenção humana |
| `AdminActionLog` | Auditoria de ações administrativas sensíveis |

### 5.2 Processos

| Processo | Responsabilidade |
|---|---|
| `release` | Executar migrações seguras antes da nova release |
| `web` | Servir HTTP, Admin, webhooks, health e documentação |
| `worker` | Executar jobs assíncronos, retries, dispatch e reconciliações |

---

## 6. Contratos de API

O backend mantém três documentos OpenAPI 3.1.2 independentes:

| Superfície | Endpoint quando habilitado | Uso |
|---|---|---|
| Store | `/openapi/store.json` | Consumidores e storefront |
| Admin | `/openapi/admin.json` | Operadores autenticados |
| Webhooks | `/openapi/webhooks.json` | Ingressos Stripe e Gelato |

A autoridade dos contratos é o registry TypeScript em `apps/backend/src/api-docs/`. Os JSONs gerados são determinísticos, versionados e não devem ser editados manualmente.

### 6.1 Swagger UI

- disponível localmente em `/docs` quando habilitada;
- usa somente assets locais e same-origin;
- não envia cookies para operações documentadas;
- não persiste autorização;
- não habilita `Try it out`;
- não permite submissão de métodos HTTP;
- serve como documentação somente leitura;
- em produção permanece desabilitada por padrão;
- Admin e Webhooks exigem usuário Medusa autenticado para serem incluídos no seletor.

### 6.2 Autenticação

| Superfície | Mecanismos |
|---|---|
| Store | Publishable API key; JWT/sessão de cliente quando exigido |
| Admin nativo | Sessão, JWT e API key conforme contrato nativo |
| Admin customizado sensível | Usuário Admin autenticado; atores API key podem ser rejeitados |
| Documentação Admin/Webhooks | Usuário autenticado do tipo `user` com `actor_id` válido |
| Webhook Stripe | Header de assinatura Stripe + raw body preservado |
| Webhook Gelato | Header canônico configurado + segredo correspondente |

---

## 7. Fluxos de uso

## 7.1 Navegação de catálogo

**Ator:** comprador convidado ou autenticado.

```text
Cliente solicita produtos publicados
→ Store API aplica o conjunto público fechado de campos
→ Backend filtra variantes não vendáveis
→ Backend retorna produtos, imagens, opções, variantes e preços em BRL
→ Dados internos Gelato não são expostos
```

Regras:

- apenas produtos publicados e variantes vendáveis são apresentados;
- a resposta pública não expõe credenciais, templates internos ou payloads de provider;
- preços do catálogo seguem o contrato monetário documentado;
- o cliente precisa enviar publishable API key nas rotas Store aplicáveis.

## 7.2 Criação e recuperação do carrinho ativo

**Ator:** convidado ou cliente autenticado.

```text
Cliente chama POST /store/carts/active
→ Backend identifica sessão convidada ou cliente autenticado
→ Se houver carrinho ativo reutilizável, retorna 200
→ Caso contrário, cria carrinho BRL e retorna 201
→ Carrinho permanece estado pré-Order
```

O carrinho público retorna itens, totais, endereço sanitizado, cliente quando autorizado e o indicador derivado `checkout_data_complete`.

## 7.3 Associação do carrinho convidado

**Ator:** cliente que iniciou compra como convidado e depois se autenticou.

```text
Cliente autentica
→ Storefront chama POST /store/customers/me/cart/attach
→ Backend valida sessão, cliente e propriedade do carrinho convidado
→ Se o cliente já possui carrinho válido, preserva o carrinho do cliente
→ Caso contrário, associa o carrinho convidado autorizado
→ Resultado informa attach ou preservação
```

O backend não permite anexar carrinho de outra sessão ou substituir silenciosamente um carrinho de cliente válido.

## 7.4 Preparação do checkout brasileiro

```text
Cliente atualiza e-mail e endereço
→ Backend valida país BR e os campos obrigatórios
→ CPF/CNPJ é aceito conforme contrato, mas nunca retornado integralmente
→ Frete, impostos e totais são recalculados
→ checkout_data_complete é derivado pelo servidor
→ Nenhum Order é criado
```

Regras:

- valores monetários são derivados no servidor;
- o cliente não pode definir totais confiáveis;
- identificador fiscal completo não deve aparecer em resposta pública, logs ou exemplos OpenAPI;
- o carrinho continua sendo a entidade principal até a confirmação canônica do pagamento.

## 7.5 Iniciação de pagamento por cartão

```text
Storefront chama POST /store/carts/{id}/payment-attempts/card
→ Backend valida acesso ao carrinho e completude do checkout
→ Backend deriva valor e moeda do carrinho
→ Backend cria ou reutiliza Payment Collection/Session conforme o fluxo
→ Backend cria PaymentAttempt idempotente
→ Stripe cria PaymentIntent de teste
→ Backend retorna client_secret efêmero
→ Storefront confirma o pagamento diretamente com Stripe.js
→ Order ainda não existe
```

Regras:

- `client_secret` nunca é persistido em logs ou exemplos;
- a confirmação do cliente não é autoridade para criar `Order`;
- o valor persistido segue contrato explícito de unidade monetária;
- nova tentativa deve invalidar ou coordenar tentativas anteriores conforme o estado.

## 7.6 Iniciação de pagamento Pix

```text
Storefront chama POST /store/carts/{id}/payment-attempts/pix
→ Backend valida carrinho e elegibilidade
→ Stripe cria PaymentIntent Pix
→ Backend retorna QR, copia-e-cola e/ou URL de instruções
→ PaymentAttempt fica pendente
→ Enquanto não houver webhook canônico de sucesso, Order não existe
```

Pix está implementado no contrato, mas sua ativação operacional depende da elegibilidade da conta Stripe.

## 7.7 Webhook Stripe e criação do Order

**Evento canônico:** `payment_intent.succeeded`.

```text
Stripe envia webhook
→ Backend preserva raw body
→ Backend valida assinatura
→ WebhookEventLog registra ou deduplica o evento
→ Backend localiza PaymentAttempt e contexto do carrinho
→ CheckoutCompletionLog coordena concorrência e idempotência
→ Backend conclui checkout e cria um único Order
→ Backend registra purchase_completed em AnalyticsEventLog
→ Backend registra intenção de e-mail em EmailDeliveryLog
→ Backend cria/elege o registro de fulfillment Gelato
→ Resposta ao webhook não depende da entrega externa aos providers
```

Invariantes:

- reentrega do mesmo webhook não duplica efeitos;
- concorrência não cria dois pedidos;
- falha do PostHog, Resend ou Gelato não desfaz o `Order` pago;
- efeitos externos são processados por jobs reexecutáveis;
- a verdade transacional é local.

## 7.8 Falha, cancelamento ou expiração do pagamento

```text
Stripe envia evento canônico de falha/cancelamento
→ Backend registra o evento de forma idempotente
→ PaymentAttempt é atualizado conforme a transição permitida
→ Carrinho pode permanecer utilizável para nova tentativa
→ Order não é criado
→ purchase_completed não é registrado
→ Fulfillment não é criado ou enviado
```

## 7.9 Entrega de analytics

```text
Order confirmado
→ AnalyticsEventLog contém purchase_completed único
→ Worker busca eventos pendentes
→ Worker envia payload sanitizado ao PostHog
→ Sucesso marca o evento como entregue
→ Falha agenda retry e gera observabilidade
```

O dispatch Gelato depende do registro local durável de `purchase_completed`, não do sucesso no PostHog.

## 7.10 E-mail de confirmação

```text
Order confirmado
→ EmailDeliveryLog registra a entrega esperada
→ Worker envia pelo Resend
→ Sucesso marca a entrega como concluída
→ Falha permanece reprocessável
```

A falha de e-mail não cancela pedido pago e não deve corromper o estado financeiro.

## 7.11 Fulfillment Gelato

```text
Order confirmado + purchase_completed local registrado
→ GelatoFulfillment é avaliado
→ Backend valida snapshot/metadados dos itens
→ Worker reserva o dispatch de forma idempotente
→ Worker envia pedido à Gelato
→ Backend persiste identificador externo e status
→ Gelato produz e envia
→ Webhook Gelato atualiza estados e tracking
```

Regras:

- um pedido não gera múltiplos dispatches ativos indevidos;
- falhas transitórias são reprocessáveis;
- falhas permanentes produzem `OperationalAlert`;
- payload externo deriva de snapshot estável dos itens do pedido;
- alteração posterior do catálogo não modifica o pedido já confirmado.

## 7.12 Webhook Gelato

```text
Gelato envia evento
→ Backend valida o header de autenticação canônico
→ WebhookEventLog registra ou deduplica
→ Backend localiza GelatoFulfillment
→ Transição de status é validada
→ Tracking é persistido quando disponível
→ Estados do fulfillment/pedido são reconciliados
→ Evento duplicado não repete efeitos
```

## 7.13 Tracking para convidado

```text
Backend gera token opaco
→ Somente o hash é persistido
→ Token é entregue ao cliente por canal autorizado
→ Cliente envia token no corpo de POST /store/tracking/lookup
→ Backend valida token e expiração
→ Resposta pública reduzida retorna referência, estados e itens sanitizados
```

Regras:

- token não aparece em path ou query;
- token nunca é logado;
- resposta não expõe endereço, e-mail, CPF/CNPJ ou dados internos;
- token inválido não permite enumeração útil de pedidos.

## 7.14 Reembolso administrativo

```text
Operador autenticado solicita reembolso no Admin
→ Backend valida ator, pedido, valor disponível e idempotency key
→ RefundRequest é criado ou reutilizado
→ Stripe recebe a solicitação
→ Estado local permanece pendente de confirmação financeira
→ Stripe envia webhook confiável
→ Backend confirma o reembolso e recalcula estado financeiro
→ AdminActionLog registra a ação
```

Regras:

- identidade do operador vem do contexto autenticado, não do body;
- valores usam centavos nas superfícies administrativas documentadas;
- reembolso não altera automaticamente `order_status` para `canceled`;
- confirmação financeira depende do webhook Stripe.

## 7.15 Troca e logística reversa

```text
Operador cria ExchangeRequest para um Order elegível
→ Backend valida ator, motivo, itens e dados permitidos
→ Sistema identifica responsabilidade pelo frete
→ Operador registra dados de logística reversa obtidos externamente
→ Status segue o grafo permitido
→ Histórico e auditoria são preservados
```

A integração com Correios é manual/semiautomática. O backend armazena as referências e decisões operacionais, mas não cria automaticamente uma autorização por API.

## 7.16 Alertas operacionais

```text
Scanner detecta pagamento travado ou fulfillment falho
→ OperationalAlert é criado ou agregado por chave estável
→ Severidade, entidade, contagem e timestamps são atualizados
→ Operador consulta lista/detalhe no Admin
→ Operador reconhece, resolve ou ignora conforme o fluxo
→ AdminActionLog preserva ações sensíveis
```

O DTO de alerta é fechado e sanitizado; payloads crus, headers e segredos não são expostos.

## 7.17 Operação e health checks

```text
GET /health/live
→ confirma que o processo HTTP responde

GET /health/ready
→ testa PostgreSQL e Redis em paralelo com timeout
→ retorna 200 quando dependências obrigatórias estão disponíveis
→ retorna 503 com resposta sanitizada quando alguma dependência falha
```

A identidade de versão é resolvida por metadados da plataforma; `APP_VERSION` atua como fallback. Localmente, a versão padrão é `dev`.

---

## 8. Requisitos funcionais consolidados

### 8.1 Catálogo e mídia

| ID | Requisito | Estado |
|---|---|---|
| BE-CAT-001 | Gerenciar produtos, variantes, preços e publicação pelo Admin | Entregue |
| BE-CAT-002 | Expor somente variantes vendáveis na Store API | Entregue |
| BE-CAT-003 | Exigir metadados Gelato para elegibilidade operacional | Entregue |
| BE-CAT-004 | Servir imagens públicas por Supabase Storage | Entregue |
| BE-CAT-005 | Preservar snapshot Gelato nos itens do pedido | Entregue |

### 8.2 Carrinho, checkout e cliente

| ID | Requisito | Estado |
|---|---|---|
| BE-CHK-001 | Criar e recuperar carrinho ativo convidado/autenticado | Entregue |
| BE-CHK-002 | Associar carrinho convidado com segurança | Entregue |
| BE-CHK-003 | Validar checkout brasileiro e derivar completude | Entregue |
| BE-CHK-004 | Manter todos os estados pré-pagamento fora de `Order` | Entregue |
| BE-CHK-005 | Não aceitar valores monetários autoritativos do cliente | Entregue |

### 8.3 Pagamento e pedido

| ID | Requisito | Estado |
|---|---|---|
| BE-PAY-001 | Iniciar cartão e Pix por `PaymentAttempt` | Entregue |
| BE-PAY-002 | Validar assinatura Stripe e preservar raw body | Entregue |
| BE-PAY-003 | Deduplicar webhooks | Entregue |
| BE-PAY-004 | Criar `Order` somente após webhook de sucesso | Entregue |
| BE-PAY-005 | Impedir duplicidade sob concorrência | Entregue |
| BE-PAY-006 | Não criar `Order` em falha/cancelamento/expiração | Entregue |
| BE-PAY-007 | Manter Pix condicionado à elegibilidade operacional | Implementado, ativação diferida |

### 8.4 Downstream

| ID | Requisito | Estado |
|---|---|---|
| BE-DWN-001 | Registrar `purchase_completed` local e idempotente | Entregue |
| BE-DWN-002 | Entregar analytics de forma assíncrona | Entregue |
| BE-DWN-003 | Entregar e-mail de forma assíncrona | Entregue |
| BE-DWN-004 | Despachar Gelato somente após elegibilidade local | Entregue |
| BE-DWN-005 | Processar webhook Gelato e tracking | Entregue |
| BE-DWN-006 | Manter falhas reprocessáveis e observáveis | Entregue |

### 8.5 Pós-venda e operação

| ID | Requisito | Estado |
|---|---|---|
| BE-OPS-001 | Tracking público por token seguro | Entregue |
| BE-OPS-002 | Solicitar reembolso no Admin | Entregue |
| BE-OPS-003 | Confirmar reembolso somente por webhook | Entregue |
| BE-OPS-004 | Registrar trocas e logística reversa | Entregue |
| BE-OPS-005 | Persistir e consultar alertas operacionais | Entregue |
| BE-OPS-006 | Auditar ações administrativas sensíveis | Entregue |

### 8.6 Documentação de API

| ID | Requisito | Estado |
|---|---|---|
| BE-DOC-001 | Manter contratos Store, Admin e Webhooks separados | Entregue |
| BE-DOC-002 | Garantir geração determinística e verificação de drift | Entregue |
| BE-DOC-003 | Expor Swagger local somente leitura | Entregue |
| BE-DOC-004 | Manter documentação desabilitada por padrão em produção | Entregue |
| BE-DOC-005 | Exigir autenticação de usuário para contratos internos | Entregue |

---

## 9. Requisitos não funcionais

| Categoria | Requisito |
|---|---|
| Segurança | Secrets somente em ambiente; nenhuma credencial ou token em logs |
| Privacidade | Coleta mínima; CPF/CNPJ mascarado nas respostas públicas |
| Idempotência | Webhooks, criação do `Order`, outboxes, dispatch e reembolso protegidos |
| Concorrência | Criação do pedido e reservas operacionais coordenadas por estado persistente/locks |
| Resiliência | Jobs reprocessáveis, retries e alertas para falhas persistentes |
| Observabilidade | Logs JSON em produção, correlation ID, Sentry sanitizado e health checks |
| Escalabilidade | Processos `web` e `worker` separados |
| Banco | Runtime por conexão apropriada e migração por conexão direta/session segura |
| Redis | Contratos separados para cache, eventos, workflows e locking |
| Manutenibilidade | TypeScript, testes críticos e contratos OpenAPI versionados |
| Operação | Migrações no processo `release`; deploy e rollback manualmente autorizados |
| Documentação | Swagger não interativo e contratos internos protegidos |

---

## 10. Estados e invariantes

### 10.1 Pagamento

Estados detalhados pertencem a `PaymentAttempt` e aos objetos Medusa/Stripe associados. A transição canônica de sucesso deve resultar em um único `Order`.

### 10.2 Pedido e fulfillment

O backend não deve comprimir todos os estados operacionais em um único campo. Estado financeiro, estado do pedido, estado do fulfillment e estado Gelato são conceitos separados.

Regras:

- `shipped` não equivale automaticamente a `completed`;
- reembolso não equivale automaticamente a cancelamento do pedido;
- falha de e-mail ou analytics não invalida pagamento confirmado;
- falha de Gelato exige atenção e reprocessamento, não duplicação automática;
- status não deve regredir sem regra explícita.

### 10.3 Unidades monetárias

- contratos Store públicos documentam explicitamente quando usam BRL em unidade maior;
- tentativas de pagamento e operações Admin sensíveis podem usar BRL em unidade menor;
- cada schema OpenAPI deve declarar sua unidade;
- conversões devem ocorrer em fronteiras explícitas e testadas.

---

## 11. Observabilidade e auditoria

### 11.1 Logs

Os logs usam allowlist. Não registrar:

- body completo por padrão;
- dados de cartão;
- `client_secret`;
- QR ou copia-e-cola Pix;
- cookies;
- `Authorization`;
- tokens de tracking;
- secrets de webhook;
- payloads de provider sem sanitização.

### 11.2 Eventos mínimos observáveis

- criação e atualização de carrinho;
- início de `PaymentAttempt`;
- ingestão e deduplicação de webhook;
- criação ou reutilização de `Order`;
- registro de `purchase_completed`;
- entrega ou retry de analytics/e-mail;
- elegibilidade e dispatch Gelato;
- atualização de tracking;
- solicitação e confirmação de reembolso;
- criação e transição de troca;
- criação, agregação e resolução de alerta;
- falhas de PostgreSQL, Redis e integrações.

### 11.3 Auditoria Admin

Ações administrativas sensíveis devem preservar:

- ator autenticado;
- tipo de ação;
- entidade afetada;
- timestamp;
- correlation ID quando aplicável;
- fatos sanitizados necessários à auditoria.

A identidade do operador nunca é aceita do corpo da requisição.

---

## 12. Ambientes, configuração e execução

### 12.1 Ambientes

- **Local:** desenvolvimento com PostgreSQL e Redis acessíveis; Admin habilitado; docs podem ser habilitadas explicitamente.
- **Produção:** Heroku com Supabase PostgreSQL e Redis; docs desabilitadas por padrão.
- **Staging:** convenção documentada, não ambiente formalmente provisionado.

### 12.2 Variáveis principais

| Grupo | Variáveis |
|---|---|
| Runtime | `NODE_ENV`, `APP_VERSION`, `WORKER_MODE`, `ADMIN_DISABLED` |
| Banco | `DATABASE_URL`, `DATABASE_MIGRATION_URL` |
| Redis | `REDIS_URL`, `CACHE_REDIS_URL`, `EVENTS_REDIS_URL`, `WE_REDIS_URL` |
| HTTP/Auth | `API_PUBLIC_URL`, `STORE_CORS`, `ADMIN_CORS`, `AUTH_CORS`, `JWT_SECRET`, `COOKIE_SECRET` |
| Storage | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FILE_URL` |
| Stripe | chaves de teste, webhook e flags de ativação |
| Resend | chave, remetente, reply-to e flag de ativação |
| Gelato | chave, método de envio, webhook e flag de dispatch |
| Observabilidade | `SENTRY_DSN` e configuração PostHog |
| API Docs | `API_DOCS_ENABLED`, `API_DOCS_UI_ENABLED`, `API_DOCS_PUBLIC_ENABLED`, `API_DOCS_INTERNAL_ENABLED` |

O arquivo `.env.template` é o contrato versionado. Valores reais não devem ser commitados.

---

## 13. Testes e gates

A estratégia de validação inclui:

- testes unitários de módulos, workflows, jobs, validadores e segurança;
- integração HTTP real das rotas Store, Admin, health e webhooks;
- integração de módulos Medusa;
- PostgreSQL descartável para constraints, locks e concorrência;
- invariantes de pagamento → webhook → `Order` → downstream;
- idempotência e reentrega de webhooks;
- contratos OpenAPI e geração determinística;
- lint e build;
- validação operacional de release, health e identidade de versão.

### 13.1 Gates OpenAPI

```bash
npm run openapi:verify:store
npm run openapi:verify:admin
npm run openapi:verify:webhooks
npm run openapi:lint
npm run openapi:check
```

`openapi:check` é read-only, gera os documentos em memória, compara bytes e verifica cobertura, metadados, segurança e fingerprints nativos.

---

## 14. Deploy, release e rollback

### 14.1 Release atual

- tag anotada: `v1.0`;
- release GitHub: `v1.0 — Backend MVP`;
- runtime validado: Heroku;
- processos: `release`, `web`, `worker`;
- saúde validada por `/health/live` e `/health/ready`;
- SHA retornado pelo runtime deve ser comparado com a release atual.

### 14.2 Deploy

O deploy deve:

1. selecionar explicitamente o candidate SHA;
2. executar migrações seguras no processo `release`;
3. iniciar `web` e `worker`;
4. validar health, PostgreSQL, Redis e identidade de versão;
5. executar smokes read-only autorizados;
6. preservar evidências sanitizadas.

### 14.3 Rollback

O alvo de rollback deve ser a release anterior compatível, registrada antes do deploy. Rollback real requer autorização humana e não foi exercitado no fechamento do milestone.

---

## 15. Critérios de aceite do backend

O backend é considerado entregue quando:

- catálogo e mídia estão operacionais em BRL;
- carrinho convidado e autenticado funcionam;
- checkout brasileiro é validado;
- `Order` não existe antes do webhook Stripe canônico;
- criação de pedido é idempotente sob reentrega e concorrência;
- `purchase_completed` é persistido localmente;
- e-mail e analytics são entregues por outboxes reprocessáveis;
- Gelato só recebe pedido elegível;
- tracking convidado usa token seguro;
- reembolso depende de confirmação Stripe;
- trocas e logística reversa são auditáveis;
- alertas operacionais podem ser consultados e tratados;
- logs e Sentry não expõem dados sensíveis;
- health checks representam PostgreSQL e Redis;
- contratos OpenAPI estão completos, determinísticos e protegidos;
- processos `web` e `worker` permanecem ativos;
- release e identidade de versão são verificáveis.

Esses critérios foram atendidos no milestone `v1.0`, respeitadas as limitações operacionais externas registradas neste documento.

---

## 16. Próximos passos de produto

O próximo milestone ainda depende de decisão humana. A direção recomendada é construir a storefront sobre os contratos Store existentes, sem reabrir os invariantes do backend.

Antes de alterar um contrato do backend, o próximo ciclo deve:

1. identificar a jornada da storefront afetada;
2. confirmar que o contrato atual é insuficiente;
3. atualizar registry, testes e artefato OpenAPI correspondente;
4. preservar compatibilidade ou documentar a quebra;
5. executar os gates globais de API Docs;
6. atualizar este PRD quando a mudança representar comportamento de produto.

---

## 17. Referências canônicas

- `.planning/PROJECT.md` — valor central, decisões e resultado do milestone;
- `.planning/STATE.md` — estado atual e gates de governança;
- `docs/DB_MODEL_v1.21.md` — modelo de dados;
- `docs/openapi/README.md` — manutenção dos contratos;
- `ops/API_DOCS.md` — exposição e segurança da documentação;
- `apps/backend/src/api-docs/generated/store.openapi.json`;
- `apps/backend/src/api-docs/generated/admin.openapi.json`;
- `apps/backend/src/api-docs/generated/webhooks.openapi.json`;
- `apps/backend/.env.template` — contrato de ambiente;
- `Procfile` — topologia Heroku.

---

*Última revisão: 2026-08-03 — documento atualizado para refletir o backend v1.0 efetivamente entregue, o runtime Heroku atual, os contratos OpenAPI e os fluxos de uso vigentes.*
