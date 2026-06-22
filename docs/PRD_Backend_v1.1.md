# PRD — Backend E-commerce POD de Camisetas

| Campo | Valor |
|---|---|
| Documento | Product Requirements Document — Backend |
| Projeto | E-commerce Headless Print-on-Demand de Camisetas |
| Versão | 1.1 |
| Base | SRS v1.5 |
| Data | 2026-06-21 |
| Status | Draft Canônico |
| Responsável | Jefferson |
| Stack | Medusa v2 · Node.js · TypeScript · PostgreSQL/Supabase · Supabase Storage · Redis · Stripe · Resend · Gelato · Sentry · PostHog |
| Deploy | VPS Linux |
| Mercado Inicial | Brasil |
| Moeda Inicial | BRL |

> **Nota da versão 1.1:** `purchase_completed` passa a ser tratado como evento de domínio persistido localmente em outbox/`AnalyticsEventLog`. O fulfillment Gelato depende do registro durável local, não do sucesso de entrega ao PostHog.

---

## 1. Objetivo

Construir o backend headless do e-commerce POD de camisetas, usando Medusa v2 como motor comercial, PostgreSQL/Supabase como banco transacional, Supabase Storage para imagens, Redis para filas/workflows, Stripe para pagamentos, Resend para e-mails, Gelato para produção/envio e Correios para registro operacional de logística reversa.

O backend deve ser a fonte de verdade para carrinho, checkout, pagamento, pedido, fulfillment, tracking, clientes, produtos, trocas, webhooks, idempotência, logs, alertas e integrações externas.

---

## 2. Escopo do Backend

### 2.1 Incluído

- Setup Medusa v2.
- APIs consumidas pela storefront.
- Admin Dashboard em subdomínio próprio.
- Produtos, variantes, preços e publicação.
- Metadados Gelato em variantes.
- Integração Supabase Storage para imagens.
- Região Brasil e moeda BRL.
- Carrinho.
- Checkout convidado e autenticado.
- Payment Collection/Payment Session.
- Integração Stripe para cartão e Pix.
- Webhook Stripe.
- Criação de Order somente após webhook canônico aprovado.
- Registro durável server-side de `purchase_completed` em outbox/`AnalyticsEventLog`.
- E-mail de confirmação via Resend antes da tentativa de fulfillment.
- Módulo customizado Gelato.
- Cotação de frete.
- Criação de pedido Gelato.
- Webhook Gelato.
- Tracking.
- Cancelamento quando possível.
- Reembolso via Admin com confirmação por webhook Stripe.
- Worker para filas/workflows.
- Alertas operacionais críticos por e-mail.
- Sentry backend.
- PostHog backend com entrega assíncrona/reprocessável a partir de evento local durável.
- Registro manual/semiautomático de logística reversa dos Correios.
- Solicitações de troca no Admin.
- Idempotência de webhooks e operações críticas.
- Logs estruturados.
- Health check.

### 2.2 Fora do Escopo do Backend MVP

- Estoque físico.
- Produção própria.
- Multi-fornecedor POD.
- Integração automatizada com API dos Correios.
- Automação de desfechos de troca sem intervenção do admin.
- ERP.
- Marketplace.
- Venda internacional.
- Multi-moeda.
- Métodos de pagamento além de cartão e Pix.
- Editor de produto.
- Upload de arte pelo cliente.

---

## 3. Arquitetura Backend

```text
Storefront Next.js
  │
  │ Store API
  ▼
Backend Medusa v2 na VPS
  │
  ├── Admin Dashboard
  ├── Worker
  ├── PostgreSQL via Supabase
  ├── Supabase Storage
  ├── Redis
  ├── Stripe
  ├── Resend
  ├── Gelato API
  ├── Sentry
  ├── PostHog
  └── Correios Logística Reversa manual/semiautomática
```

### 3.1 Componentes

| Componente | Responsabilidade |
|---|---|
| Medusa Server | APIs, Admin, produtos, carrinhos, clientes, pedidos, pagamentos, fulfillment. |
| Worker | Workflows, filas, retries, e-mails, fulfillment, alertas. |
| PostgreSQL/Supabase | Persistência transacional. |
| Supabase Storage | Imagens e assets de produto. |
| Redis | Event bus, filas, cache e workflows. |
| Stripe Module | Cartão, Pix, webhooks, reembolsos. |
| Gelato Fulfillment Module | Frete, produção, cancelamento, status, tracking. |
| Resend Module | E-mails transacionais e alertas operacionais. |
| Returns/Exchange Module | Registro operacional de trocas e logística reversa. |
| Observability Module | Logs, Sentry, PostHog e health checks. |

---

## 4. Fluxos Backend Críticos

### 4.1 Checkout e Cartão

```text
Storefront cria/atualiza carrinho
→ Backend calcula frete
→ Backend cria Payment Collection/Payment Session
→ Backend cria PaymentIntent Stripe
→ Cliente paga no Stripe
→ Stripe envia webhook payment_intent.succeeded
→ Backend valida assinatura e idempotência
→ Backend conclui checkout no Medusa
→ Backend cria/confirma Order
→ Backend registra duravelmente purchase_completed em outbox/AnalyticsEventLog
→ Backend enfileira entrega assíncrona de purchase_completed ao PostHog
→ Backend envia e-mail de confirmação via Resend
→ Backend inicia workflow de fulfillment Gelato sem depender do sucesso de entrega ao PostHog
```

### 4.2 Checkout e Pix

```text
Storefront cria/atualiza carrinho
→ Backend calcula frete
→ Backend cria Payment Collection/Payment Session
→ Backend cria PaymentIntent Pix
→ Storefront exibe QR/copia-e-cola
→ Enquanto Pix está pendente, Order não existe
→ Stripe envia webhook canônico de pagamento aprovado
→ Backend valida assinatura e idempotência
→ Backend conclui checkout no Medusa
→ Backend cria/confirma Order
→ Backend registra duravelmente purchase_completed em outbox/AnalyticsEventLog
→ Backend enfileira entrega assíncrona de purchase_completed ao PostHog
→ Backend envia e-mail de confirmação
→ Backend inicia fulfillment Gelato sem depender do sucesso de entrega ao PostHog
```

### 4.3 Falha no Pagamento

```text
Stripe envia payment_failed/canceled/expiração equivalente
→ Backend registra evento
→ Backend mantém carrinho/Payment Collection disponível quando aplicável
→ Backend não cria Order
→ Backend não inicia fulfillment
→ Backend permite nova tentativa
```

### 4.4 Fulfillment Gelato

```text
Order confirmado + purchase_completed registrado duravelmente
→ Entrega ao PostHog segue assíncrona e não bloqueia Gelato
→ Worker inicia workflow de fulfillment
→ Backend valida metadados Gelato
→ Backend cria pedido Gelato
→ Backend persiste gelato_order_id
→ Gelato processa produção/envio
→ Gelato envia webhook
→ Backend atualiza fulfillment/order status
→ Backend salva tracking
→ Backend envia e-mail de tracking
```

### 4.5 Falha na Gelato

```text
Order confirmado
→ purchase_completed registrado duravelmente
→ e-mail de confirmação enviado
→ Workflow tenta criar pedido Gelato
→ Gelato retorna erro/timeout
→ Retry com backoff
→ Se persistir, fulfillment = failed
→ Order pode ir para requires_attention
→ Sentry registra erro
→ Alerta operacional por e-mail ao admin
→ Admin pode reprocessar ou cancelar/reembolsar
```

### 4.6 Retorno Assíncrono do Checkout

O backend deve expor endpoint ou mecanismo equivalente para a storefront consultar se o Order já foi criado após retorno do Stripe.

O endpoint deve:

- aceitar referência segura (`cart_id`, `payment_intent_id` ou token equivalente);
- não expor dados sensíveis;
- retornar estado de confirmação;
- retornar Order somente quando existir e for autorizado;
- suportar timeout/retry pelo frontend.

---

## 5. Requisitos Funcionais — Backend

### 5.1 Produtos e Catálogo

| ID | Requisito | Prioridade | Critério de Aceite |
|---|---|---|---|
| BE-PR-001 | Criar produtos no Admin. | Must Have | Admin cadastra título, descrição, imagens, preço e variantes. |
| BE-PR-002 | Editar produtos. | Must Have | Alterações refletem na storefront após atualização/cache. |
| BE-PR-003 | Publicar/despublicar produtos. | Must Have | Produto despublicado não aparece na storefront. |
| BE-PR-004 | Configurar variantes. | Must Have | Variante contém tamanho, cor, SKU, preço em BRL e metadados Gelato. |
| BE-PR-005 | Bloquear variante sem mapeamento Gelato. | Must Have | Variante sem metadados obrigatórios não é vendável. |
| BE-PR-006 | Bloquear publicação sem template Gelato válido. | Must Have | Produto incompleto não é vendido sem override consciente. |
| BE-PR-007 | Expor APIs de catálogo para storefront. | Must Have | Storefront recebe produtos publicados, preços e variantes válidas. |
| BE-PR-008 | Validar mapeamentos Gelato pré-go-live. | Must Have | Script/rotina lista variantes sem metadados obrigatórios. |
| BE-PR-009 | Suportar coleções/categorias. | Should Have | Produtos podem ser filtrados por coleção/categoria. |
| BE-PR-010 | Suportar busca textual. | Could Have | Busca por nome/termo relevante. |

---

### 5.2 Storage de Imagens

| ID | Requisito | Prioridade | Critério de Aceite |
|---|---|---|---|
| BE-ST-001 | Usar Supabase Storage para imagens. | Must Have | Imagens cadastradas no Admin são armazenadas no bucket definido. |
| BE-ST-002 | Gerar URLs consumíveis pela storefront. | Must Have | MVP usa URLs públicas com políticas de leitura adequadas. |
| BE-ST-003 | Suportar thumbnail e galeria. | Must Have | Produto tem imagem principal e adicionais. |
| BE-ST-004 | Validar tipo e tamanho. | Should Have | Upload inválido é recusado com mensagem clara. |
| BE-ST-005 | Organizar arquivos por ambiente. | Should Have | Produção, staging e dev não compartilham paths críticos sem controle. |
| BE-ST-006 | Evitar exposição de secrets em bucket público. | Must Have | Bucket público não contém documentos sensíveis ou credenciais. |

---

### 5.3 Carrinho e Checkout

| ID | Requisito | Prioridade | Critério de Aceite |
|---|---|---|---|
| BE-CH-001 | Criar carrinho para visitante. | Must Have | Cart é criado ao adicionar primeiro item. |
| BE-CH-002 | Persistir carrinho. | Must Have | Carrinho pode ser recuperado durante a sessão. |
| BE-CH-003 | Adicionar/alterar/remover itens. | Must Have | Totais são recalculados corretamente. |
| BE-CH-004 | Validar endereço brasileiro. | Must Have | País deve ser `BR`; endereços fora do Brasil são rejeitados. |
| BE-CH-005 | Calcular frete antes do pagamento. | Must Have | Backend retorna opções compatíveis com Gelato/endereço. |
| BE-CH-006 | Criar Payment Collection/Payment Session. | Must Have | Criada sem criar Order antecipadamente. |
| BE-CH-007 | Manter estado pré-pagamento no carrinho/Payment Collection. | Must Have | Order não existe antes de webhook aprovado. |
| BE-CH-008 | Suportar checkout autenticado. | Must Have | Order confirmado fica associado à conta quando cliente está logado. |
| BE-CH-009 | Suportar checkout convidado. | Must Have | Order confirmado pode ser acompanhado por token. |
| BE-CH-010 | Expor estado de confirmação assíncrona. | Must Have | Storefront consulta se Order já foi criado após retorno Stripe. |

---

### 5.4 Pagamentos Stripe

| ID | Requisito | Prioridade | Critério de Aceite |
|---|---|---|---|
| BE-PG-001 | Integrar Stripe como provedor. | Must Have | Backend cria PaymentIntent válido para cartão e Pix. |
| BE-PG-002 | Suportar cartão. | Must Have | Pagamento por cartão funciona em produção. |
| BE-PG-003 | Suportar Pix. | Must Have | Pix funciona em produção. |
| BE-PG-004 | Não processar dados sensíveis de cartão. | Must Have | Dados de cartão são tratados pelo Stripe. |
| BE-PG-005 | Validar webhook Stripe. | Must Have | Assinatura inválida é rejeitada e não altera estado. |
| BE-PG-006 | Processar pagamento aprovado. | Must Have | Webhook aprovado conclui checkout, cria Order, registra duravelmente `purchase_completed` em outbox/`AnalyticsEventLog`, enfileira entrega ao PostHog e inicia e-mail/fulfillment sem depender do sucesso do PostHog. |
| BE-PG-007 | Processar pagamento falho/expirado/cancelado. | Must Have | Não cria Order nem fulfillment. |
| BE-PG-008 | Implementar idempotência do webhook. | Must Have | Evento duplicado não duplica Order, e-mail, fulfillment ou tracking. |
| BE-PG-009 | Implementar idempotência de criação do Order. | Must Have | Chave: `payment_intent_id` ou `cart_id + payment_intent_id`. |
| BE-PG-010 | Permitir reembolso via Admin. | Must Have | Admin inicia reembolso; status só atualiza após webhook Stripe. |
| BE-PG-011 | Não forçar cancelamento por reembolso. | Must Have | Reembolso altera estado financeiro, não `order_status` automaticamente. |
| BE-PG-012 | Registrar eventos de pagamento. | Must Have | Logs/auditoria incluem PaymentIntent, método, status, cart e order quando existir. |

---

### 5.5 Pedidos

| ID | Requisito | Prioridade | Critério de Aceite |
|---|---|---|---|
| BE-OR-001 | Criar Order somente após pagamento confirmado. | Must Have | Order nasce após webhook Stripe canônico aprovado. |
| BE-OR-002 | Atribuir número identificável. | Must Have | Cliente e admin conseguem referenciar pedido. |
| BE-OR-003 | Exibir pedidos no Admin. | Must Have | Lista e detalhe exibem dados necessários. |
| BE-OR-004 | Manter status de pagamento. | Must Have | Estados financeiros seguem definição do SRS. |
| BE-OR-005 | Manter status de pedido. | Must Have | Estados: confirmed, in_fulfillment, shipped, delivered, completed, canceled, requires_attention. |
| BE-OR-006 | Manter status de fulfillment. | Must Have | Estados mapeiam Gelato para interno. |
| BE-OR-007 | Registrar tracking. | Must Have | Tracking number/url são salvos quando disponíveis. |
| BE-OR-008 | Gerar token seguro de tracking. | Must Have | Token é único, imprevisível, server-side e expira em 365 dias. |
| BE-OR-009 | Incluir token em e-mails. | Must Have | Token vai no e-mail de confirmação e no e-mail de envio/rastreio. |
| BE-OR-010 | Cancelar pedido pelo Admin. | Must Have | Cancelamento respeita status Gelato. |
| BE-OR-011 | Exibir histórico de eventos. | Should Have | Admin audita mudanças relevantes. |
| BE-OR-012 | Exportar pedidos. | Could Have | CSV pós-MVP. |
| BE-OR-013 | Associar trocas ao pedido. | Must Have | Detalhe do pedido exibe histórico de trocas. |

---

### 5.6 Estados de Pedido

| Estado | Descrição |
|---|---|
| `confirmed` | Pedido criado/confirmado após pagamento capturado por webhook Stripe. |
| `in_fulfillment` | Pedido em processo de produção/envio. |
| `shipped` | Pedido despachado; produto pode estar em trânsito. |
| `delivered` | Pedido entregue, se evento de entrega disponível. |
| `completed` | Ciclo operacional encerrado após entrega ou fechamento pós-entrega. |
| `canceled` | Pedido cancelado. |
| `requires_attention` | Pedido exige intervenção administrativa. |

Regra: `completed` não deve ser usado apenas porque o pedido foi despachado.

---

### 5.7 Gelato Fulfillment Module

| ID | Requisito | Prioridade | Critério de Aceite |
|---|---|---|---|
| BE-GL-001 | Implementar módulo customizado Gelato. | Must Have | Integrado ao fluxo de fulfillment do Medusa. |
| BE-GL-002 | Mapear variantes para templates fixos Gelato. | Must Have | Cada variante vendável possui metadados obrigatórios. |
| BE-GL-003 | Validar metadados antes do fulfillment. | Must Have | Falta de metadados bloqueia fulfillment e pode mover pedido para `requires_attention`. |
| BE-GL-004 | Criar pedido Gelato após Order + `purchase_completed` registrado duravelmente. | Must Have | Fulfillment não inicia antes do registro local durável de `purchase_completed`; falha temporária do PostHog não bloqueia Gelato. |
| BE-GL-005 | Persistir `gelato_order_id`. | Must Have | ID externo salvo para rastreamento. |
| BE-GL-006 | Consultar cotação de frete. | Must Have | Checkout recebe opções compatíveis. |
| BE-GL-007 | Processar webhooks Gelato. | Must Have | Eventos atualizam fulfillment correspondente. |
| BE-GL-008 | Registrar tracking recebido. | Must Have | Tracking salvo e exposto à storefront/e-mail. |
| BE-GL-009 | Cancelar pedido Gelato quando possível. | Must Have | Cancelamento só ocorre se produção permitir. |
| BE-GL-010 | Implementar retries. | Must Have | Falhas temporárias são reprocessadas com backoff. |
| BE-GL-011 | Registrar logs de chamadas Gelato. | Must Have | Request/response/status/correlation ID sem secrets. |
| BE-GL-012 | Reprocessar fulfillment manualmente. | Must Have | Admin reprocessa pedido falho respeitando idempotência. |
| BE-GL-013 | Sincronizar catálogo Gelato. | Should Have | Rotina auxiliar para verificar/importar produtos. |

---

### 5.8 E-mails e Alertas

| ID | Requisito | Prioridade | Critério de Aceite |
|---|---|---|---|
| BE-EM-001 | Enviar e-mail de confirmação. | Must Have | Enviado após Order confirmado e antes da tentativa Gelato. |
| BE-EM-002 | Enviar e-mail de envio/rastreio. | Must Have | Enviado quando tracking estiver disponível. |
| BE-EM-003 | Enviar e-mail de cancelamento. | Must Have | Cliente é notificado quando pedido for cancelado. |
| BE-EM-004 | Enviar e-mail de reembolso. | Must Have | Apenas após confirmação do reembolso por webhook Stripe. |
| BE-EM-005 | Enviar boas-vindas. | Should Have | Cliente registrado recebe confirmação. |
| BE-EM-006 | Enviar recuperação de senha. | Must Have | Link com validade limitada. |
| BE-EM-007 | Registrar falha de e-mail. | Must Have | Falha é logada e reprocessável. |
| BE-EM-008 | Falha de e-mail não cancela pedido pago. | Must Have | Pedido pago permanece válido. |
| BE-EM-009 | Enviar alertas críticos ao admin. | Must Have | Falhas críticas geram e-mail operacional. |
| BE-EM-010 | Enviar instruções de troca. | Must Have | Cliente recebe código/instruções após aprovação. |

---

### 5.9 Admin Backend

| ID | Requisito | Prioridade | Critério de Aceite |
|---|---|---|---|
| BE-AD-001 | Admin em subdomínio próprio. | Must Have | Acesso protegido por autenticação. |
| BE-AD-002 | Gerenciar produtos. | Must Have | Criar, editar, publicar/despublicar. |
| BE-AD-003 | Gerenciar variantes. | Must Have | Tamanho, cor, SKU, preço e metadados Gelato. |
| BE-AD-004 | Visualizar pedidos. | Must Have | Lista e detalhe de pedidos. |
| BE-AD-005 | Cancelar pedido. | Must Have | Aciona lógica Gelato/reembolso/e-mail quando aplicável. |
| BE-AD-006 | Gerenciar clientes. | Should Have | Visualizar cliente e histórico de compras. |
| BE-AD-007 | Configurar Brasil/BRL. | Must Have | Região principal Brasil e moeda BRL. |
| BE-AD-008 | Configurar métodos de envio. | Must Have | Compatíveis com Gelato. |
| BE-AD-009 | Configurar promoções/cupons. | Should Have | Cupom com valor, validade e limite. |
| BE-AD-010 | Registrar trocas. | Must Have | Admin cria e acompanha solicitações de troca. |
| BE-AD-011 | Filtrar pedidos `requires_attention`. | Must Have | Admin identifica pedidos que exigem ação. |
| BE-AD-012 | Reprocessar fulfillment Gelato. | Must Have | Ação registra log de auditoria. |
| BE-AD-013 | Visualizar alertas críticos. | Could Have | Alertas podem iniciar apenas por e-mail. |

---

### 5.10 Trocas e Logística Reversa

| ID | Requisito | Prioridade | Critério de Aceite |
|---|---|---|---|
| BE-RT-001 | Registrar solicitação de troca. | Must Have | Registro vinculado ao pedido original. |
| BE-RT-002 | Identificar primeira troca. | Must Have | Primeira troca marca frete pago pela empresa. |
| BE-RT-003 | Identificar trocas adicionais. | Must Have | Troca adicional marca frete pago pelo cliente. |
| BE-RT-004 | Registrar autorização Correios. | Must Have | Código, prazo e instruções quando disponíveis. |
| BE-RT-005 | Disparar e-mail de troca aprovada. | Must Have | E-mail após aprovação e instruções disponíveis. |
| BE-RT-006 | Manter histórico de troca. | Must Have | Admin audita status e decisões. |
| BE-RT-007 | Suportar status de troca. | Must Have | requested, approved, awaiting_posting, posted, received, completed, rejected, canceled. |
| BE-RT-008 | Operar Correios manual/semiautomático. | Must Have | Admin registra dados obtidos fora do sistema; sistema armazena e envia e-mail. |

---

### 5.11 Analytics e Monitoramento Backend

| ID | Requisito | Prioridade | Critério de Aceite |
|---|---|---|---|
| BE-AN-001 | Registrar `purchase_completed` pelo backend. | Must Have | Evento registrado de forma durável após Order confirmado; único evento de receita/conversão. Entrega ao PostHog é assíncrona e reprocessável. |
| BE-AN-002 | Usar identificador analítico seguro. | Must Have | Não enviar `order_id` interno ao PostHog. |
| BE-AN-003 | Integrar Sentry backend. | Must Have | Exceções backend e falhas críticas reportadas. |
| BE-AN-004 | Registrar logs estruturados. | Must Have | Logs contêm contexto, evento, pedido, fulfillment e correlation ID. |
| BE-AN-005 | Enviar alertas críticos por e-mail. | Must Have | Falhas operacionais severas chegam ao admin. |

#### Regra de outbox para `purchase_completed`

O backend deve tratar `purchase_completed` em duas etapas:

1. **Registro local durável:** criar ou localizar um `AnalyticsEventLog`/outbox com chave idempotente, por exemplo `purchase_completed:{order_id}`.
2. **Entrega externa assíncrona:** enfileirar envio ao PostHog com retry/backoff.

O workflow de fulfillment Gelato pode iniciar após o registro local durável de `purchase_completed`. Ele não deve aguardar `sent`/sucesso de entrega ao PostHog. Falhas temporárias do PostHog devem gerar retry e observabilidade, mas não bloquear produção de pedido pago.


---

## 6. Webhooks e Idempotência

### 6.1 Webhook Stripe

Requisitos:

- Validar assinatura.
- Persistir ID do evento.
- Ignorar evento duplicado.
- Processar apenas eventos confirmados em sandbox.
- Não criar Order antes de pagamento confirmado.
- Não iniciar fulfillment em Pix pendente, expirado, cancelado ou falho.
- Atualizar reembolso apenas após evento confiável.

Efeitos permitidos:

- Atualizar PaymentIntent/Payment Session.
- Concluir checkout.
- Criar Order confirmado.
- Registrar duravelmente `purchase_completed` em outbox/`AnalyticsEventLog`.
- Enfileirar entrega assíncrona de `purchase_completed` ao PostHog.
- Enviar e-mail de confirmação.
- Iniciar fulfillment após pré-condições.
- Registrar falhas/expirações/cancelamentos.

### 6.2 Webhook Gelato

Requisitos:

- Validar autenticidade.
- Persistir ID ou hash do evento.
- Localizar fulfillment por `gelato_order_id`.
- Ignorar duplicados.
- Não retroceder status sem regra explícita.
- Registrar payload mínimo.
- Reportar falhas ao Sentry.
- Enviar alerta em falhas persistentes.

### 6.3 Idempotency Keys

| Operação | Chave Recomendada |
|---|---|
| Processar webhook Stripe | `stripe_event_id` |
| Concluir checkout / criar Order Medusa | `payment_intent_id` ou `cart_id + payment_intent_id` |
| Criar pedido Gelato | `medusa_order_id` |
| Enviar e-mail de confirmação | `order_id + email_type` |
| Enviar alerta operacional | `alert_type + entity_id + date_bucket` |
| Processar webhook Gelato | `gelato_event_id` ou hash do payload |
| Reembolso | `order_id + refund_id` |
| Criar/atualizar troca | `order_id + exchange_id` ou `order_id + exchange_number` |

---

## 7. Requisitos Não Funcionais — Backend

| ID | Requisito | Critério |
|---|---|---|
| BE-NFR-PERF-001 | APIs críticas devem responder com baixa latência. | P95 inferior a 500ms para operações simples em condições normais. |
| BE-NFR-PERF-002 | Webhooks devem responder rapidamente. | Stripe/Gelato recebem HTTP em até 5s sempre que possível. |
| BE-NFR-PERF-003 | Operações longas devem ser assíncronas. | Fulfillment, retries, e-mails e alertas usam worker/fila. |
| BE-NFR-SEC-001 | HTTPS obrigatório. | API/Admin com TLS válido em produção. |
| BE-NFR-SEC-002 | Secrets em variáveis de ambiente. | Chaves não são versionadas. |
| BE-NFR-SEC-003 | CORS restrito. | Apenas domínios autorizados. |
| BE-NFR-SEC-004 | Rate limiting em endpoints sensíveis. | Login, checkout, webhook e formulários protegidos. |
| BE-NFR-SEC-005 | Logs sem dados sensíveis. | Secrets, tokens e dados de cartão não aparecem em logs. |
| BE-NFR-AVL-001 | Backend reinicia após falha. | PM2 ou equivalente mantém processos vivos. |
| BE-NFR-AVL-002 | Redis monitorado. | Falha gera Sentry e alerta por e-mail. |
| BE-NFR-AVL-003 | Workflows com retry. | Falhas temporárias reprocessáveis. |
| BE-NFR-AVL-004 | Webhooks idempotentes. | Duplicatas não causam efeitos colaterais. |
| BE-NFR-AVL-005 | Health check. | Endpoint de saúde monitorável. |
| BE-NFR-SCL-001 | Server e worker separados. | Worker escala sem escalar API. |
| BE-NFR-SCL-002 | Pooling de banco. | Evita esgotamento de conexões Supabase. |
| BE-NFR-MNT-001 | TypeScript. | Evitar JS não tipado em código de aplicação. |
| BE-NFR-MNT-002 | Testes para código crítico. | Gelato, Stripe, Pix, storage, payloads e webhooks cobertos. |
| BE-NFR-MNT-003 | `.env.example`. | Todas variáveis obrigatórias documentadas. |
| BE-NFR-LGPD-001 | Coleta mínima de dados. | Checkout pede apenas dados necessários. |
| BE-NFR-LGPD-002 | Sentry com scrubbing. | Dados sensíveis removidos de eventos. |
| BE-NFR-LGPD-003 | PostHog sem dados sensíveis. | Payloads não contêm dados pessoais desnecessários. |

---

## 8. Observabilidade Backend

### 8.1 Logs Obrigatórios

| Evento | Dados Mínimos |
|---|---|
| Criação de carrinho | `cart_id`, `session_id` |
| Início de checkout | `cart_id`, `email`, `region` |
| Criação de Payment Collection/Session | `cart_id`, `payment_collection_id`, `payment_session_id`, `payment_method_type` |
| Criação de pagamento | `cart_id`, `payment_intent_id`, `payment_method_type` |
| Retorno aguardando confirmação | `cart_id`, `payment_intent_id`, `confirmation_state`, `timeout_status` |
| Webhook Stripe | `event_id`, `type`, `status` |
| Order criado após pagamento | `order_id`, `display_id`, `payment_status`, `total` |
| `purchase_completed` registrado | `order_id`, `order_analytics_id`, `total`, `payment_method_type`, `analytics_event_log_id`, `delivery_status` |
| Fulfillment iniciado | `order_id`, `fulfillment_id` |
| Chamada Gelato | `order_id`, `operation`, `status_code`, `latency_ms` |
| Webhook Gelato | `event_id`, `gelato_order_id`, `status` |
| E-mail enviado | `order_id`, `template`, `recipient`, `status` |
| Alerta operacional | `alert_type`, `severity`, `recipient`, `entity_id` |
| Upload de imagem | `product_id`, `bucket`, `path`, `size` |
| Solicitação de troca | `order_id`, `exchange_id`, `shipping_cost_owner` |
| Erro crítico | `error_code`, `message`, `correlation_id`, `sentry_event_id` |

### 8.2 Alertas Mínimos

| Alerta | Canal | Severidade |
|---|---|---|
| Backend indisponível | E-mail | Crítica |
| Redis indisponível | E-mail | Crítica |
| Pedido pago sem fulfillment criado | E-mail | Crítica |
| Falha recorrente Gelato API | E-mail | Alta |
| Falha recorrente Stripe webhook | E-mail | Alta |
| Falha recorrente em e-mails | E-mail | Média |
| Pool de conexões próximo do limite | E-mail | Média |
| CPU/memória elevada na VPS | E-mail | Média |
| Erro crítico no Sentry | E-mail/Sentry | Alta |
| Falha de upload Supabase Storage | E-mail/Sentry | Média |

---

## 9. Variáveis de Ambiente — Backend

```env
NODE_ENV=
DATABASE_URL=
REDIS_URL=
JWT_SECRET=
COOKIE_SECRET=
STORE_CORS=
ADMIN_CORS=
AUTH_CORS=

STRIPE_API_KEY=
STRIPE_WEBHOOK_SECRET=

RESEND_API_KEY=
RESEND_FROM_EMAIL=
ADMIN_ALERT_EMAIL=

GELATO_API_KEY=
GELATO_API_BASE_URL=
GELATO_WEBHOOK_SECRET=

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET_PRODUCT_IMAGES=

SENTRY_DSN=
SENTRY_ENVIRONMENT=

POSTHOG_API_KEY=
POSTHOG_HOST=

MEDUSA_BACKEND_URL=
STORE_FRONTEND_URL=
ADMIN_URL=
```

---

## 10. Testes — Backend

### 10.1 Testes Unitários

Devem cobrir:

- Montagem de payload Gelato.
- Validação de metadados Gelato.
- Mapeamento de status Gelato.
- Idempotência Stripe.
- Idempotência de criação do Order.
- Pix pendente/expirado/falho não cria Order.
- Pix confirmado cria Order.
- Reembolso só atualiza após webhook.
- `purchase_completed` registrado em outbox/`AnalyticsEventLog`.
- Token de tracking.
- Regras de troca.
- Upload/path Supabase Storage.
- Cálculo de totais.

### 10.2 Testes de Integração

Devem cobrir:

- Criação de carrinho.
- Checkout com endereço Brasil.
- Payment Collection/Session sem Order.
- Cartão modo teste.
- Pix modo teste.
- Webhook cartão aprovado criando Order.
- Webhook Pix aprovado criando Order.
- Pix expirado sem Order.
- Bloqueio de fulfillment antes de pagamento.
- Registro durável de `purchase_completed`.
- E-mail de confirmação antes de Gelato.
- Criação de pedido Gelato.
- Webhook Gelato.
- Upload Supabase.
- E-mail Resend.
- Reembolso confirmado por Stripe.
- Alertas operacionais.
- Sentry.
- PostHog.

### 10.3 Testes E2E Backend

Fluxo cartão:

```text
Carrinho criado
→ Frete calculado
→ Payment Session criada
→ Pagamento cartão aprovado por webhook
→ Order criado
→ purchase_completed registrado duravelmente
→ E-mail confirmação enviado
→ Gelato fulfillment criado
→ Tracking salvo
```

Fluxo Pix:

```text
Carrinho criado
→ Frete calculado
→ Payment Session Pix criada
→ Pix pendente sem Order
→ Pix aprovado por webhook
→ Order criado
→ purchase_completed registrado duravelmente
→ E-mail confirmação enviado
→ Gelato fulfillment criado
```

Fluxo troca:

```text
Order entregue
→ Admin cria troca
→ Sistema identifica primeira troca
→ Frete empresa
→ Admin registra Correios
→ Sistema envia instruções
→ Histórico fica no pedido
```

---

## 11. Deploy e Operação

### 11.1 Backend

- VPS Linux.
- Node.js compatível.
- Redis ativo.
- Medusa server gerenciado por PM2 ou equivalente.
- Worker separado.
- Nginx ou equivalente com HTTPS.
- API em subdomínio próprio.
- Admin em subdomínio próprio.
- Health check.
- Logs persistentes.
- Sentry backend.
- Alertas por e-mail.

### 11.2 Banco

- Supabase configurado.
- Banco produção separado de dev/staging.
- Pooling em produção.
- Backups ativos.
- Migrações versionadas.
- Acesso restrito.

### 11.3 Storage

- Bucket Supabase para imagens.
- Políticas de acesso configuradas.
- Separação por ambiente.
- Validação de upload.
- URLs funcionais para storefront.
- Estratégia para imagens órfãs.

---

## 12. Critérios de Aceite do PRD Backend

O backend será considerado pronto quando:

- Medusa v2 estiver rodando em VPS.
- Admin estiver em subdomínio próprio com autenticação.
- Produtos e variantes forem gerenciáveis.
- Variante sem metadados Gelato não for vendável.
- Produto sem template Gelato válido não puder ser publicado.
- Supabase PostgreSQL estiver conectado.
- Supabase Storage estiver integrado.
- Redis estiver ativo.
- Brasil/BRL configurados.
- Carrinho e checkout funcionarem.
- Payment Collection/Payment Session forem criadas sem criar Order antecipado.
- Cartão funcionar em produção.
- Pix funcionar em produção.
- Pix pendente/expirado/cancelado/falho não criar Order.
- Webhook Stripe aprovado criar Order idempotentemente.
- `purchase_completed` for registrado duravelmente pelo backend após Order confirmado.
- E-mail de confirmação for enviado antes da tentativa Gelato.
- Fulfillment Gelato iniciar apenas após Order + `purchase_completed` registrado localmente, sem depender de PostHog.
- Webhook Gelato atualizar status.
- Pedido despachado usar `shipped`, não `completed`.
- `completed` só ocorrer após entrega ou fechamento operacional pós-entrega.
- Reembolso não forçar `order_status = canceled`.
- Token de tracking for seguro e incluído nos e-mails exigidos.
- Admin registrar e acompanhar trocas.
- Primeira troca marcar frete empresa.
- Troca adicional marcar frete cliente.
- Correios operar manual/semiautomático no Admin.
- Sentry capturar erros.
- Alertas críticos por e-mail funcionarem.
- Logs estruturados existirem.
- Webhooks e criação de Order forem idempotentes.
- Secrets não estiverem expostos.
- Smoke test ponta a ponta passar.

---

## 13. Questões Abertas Relacionadas ao Backend

| ID | Questão | Impacto | Prazo |
|---|---|---|---|
| BE-Q-001 | Nome final do bucket Supabase Storage. | Env vars, storage, deploy. | Antes da fase backend. |
| BE-Q-002 | Prefixo final da API. | CORS, webhooks, deploy. | Antes de staging. |
| BE-Q-003 | Prefixo final do Admin. | Segurança, CORS, deploy. | Antes de staging. |
| BE-Q-004 | E-mail remetente transacional. | Resend, domínio, reputação. | Antes de go-live. |
| BE-Q-005 | E-mail destinatário de alertas operacionais. | Operação. | Antes de staging. |
| BE-Q-006 | Política detalhada de troca. | Admin, e-mails, operação. | Antes de go-live. |
| BE-Q-007 | Canal e fluxo LGPD. | Privacidade, atendimento, operação. | Antes de go-live. |

---