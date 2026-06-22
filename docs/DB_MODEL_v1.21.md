# DB_MODEL — Modelo de Dados do E-commerce POD

| Campo | Valor |
|---|---|
| Documento | DB_MODEL |
| Versão | 1.21 |
| Data | 2026-06-22 |
| Status | Revisado |
| Base funcional | SRS v1.5 e PRD Backend v1.1 |
| Escopo desta versão | Correção do achado 4: explicitação das constraints monetárias para `Payment` e `Refund`, incluindo valores inteiros na menor unidade monetária, não negatividade, captura limitada ao valor autorizado, reembolso positivo, moeda consistente e bloqueio transacional de reembolso acima do saldo capturado disponível. |

> Versionamento: major.minor sequencial. A versão 1.21 representa a vigésima primeira revisão minor da versão 1, não um número decimal.

---

## Changelog

| Versão | Data | Alterações |
|---|---:|---|
| 1.21 | 2026-06-22 | Corrigido o achado 4: adicionadas constraints monetárias explícitas para `Payment` e `Refund`. `Payment.amount` e `Payment.captured_amount` devem ser inteiros não negativos na menor unidade monetária; `Payment.captured_amount` não pode exceder `Payment.amount`; `Refund.amount` deve ser inteiro positivo; `Refund.currency_code` deve ser igual a `Payment.currency_code`; no MVP, `Payment.currency_code` e `Refund.currency_code` devem ser `BRL`; e o valor de reembolso deve respeitar o saldo capturado disponível considerando refunds confirmados e bloqueados. Atualizadas seções 2.10, 4.8, 4.9, 5.12, 5.13, regras `DATA-106`, `DATA-117` a `DATA-122` e constraints recomendadas. |
| 1.20 | 2026-06-21 | Corrigido o achado 3: definida a fonte de verdade financeira para reembolsos. `Refund.status = succeeded` passa a ser a fonte de verdade para valores reembolsados confirmados; `Payment.status` e `Order.payment_status` são campos derivados/denormalizados que devem ser recalculados na mesma transação lógica que confirma reembolso via webhook Stripe. Proibida alteração manual isolada desses status sem recomputação a partir de `Payment.captured_amount` e `Refund.status = succeeded`. Atualizadas as seções 2.10, 4.8, 4.9, 5.12, relações, regras `DATA-053`, `DATA-054`, `DATA-107` e adicionadas `DATA-114` a `DATA-116`. |
| 1.19 | 2026-06-21 | Corrigido o achado 2: adicionada `WebhookEventLog.deduplication_key` como chave canônica de deduplicação. A deduplicação passa a ser garantida por `unique(provider, deduplication_key)`. Quando `external_event_id` existir e for confiável, a chave deve derivar dele; quando não existir, deve derivar de `payload_hash` normalizado ou de chave determinística equivalente validada na integração. `payload_hash` isolado passa a ser índice diagnóstico, não garantia de unicidade. Atualizadas `DATA-005`, `DATA-030`, `DATA-031`, seção 4.5, seção 5.8 e índices recomendados. |
| 1.18 | 2026-06-21 | Corrigido o achado 1: `AnalyticsEventLog` passa a operar como outbox local durável. `status` foi alterado para `recorded | queued | sent | failed | ignored`; `purchase_completed` não precisa estar `sent` no PostHog para liberar Gelato. Fulfillment passa a depender do registro local durável do evento, com entrega externa assíncrona e reprocessável. Atualizadas `DATA-003` e `DATA-103`. |
| 1.17 | 2026-06-21 | Corrigidos os achados 8 a 13: confirmado uso canônico de `exchange_request` em `OperationalAlert.entity_type`; explicitado que `purchase_completed` é o único `AnalyticsEventLog.event_name` obrigatório no MVP; definida fronteira entre `PaymentSession` e `PaymentAttempt`; removida quebra/higiene em `ExchangeRequest`; ajustada `DATA-003` para referenciar o registro durável em `AnalyticsEventLog`; e consolidada `DATA-044` como regra técnica da idempotency key de analytics. |
| 1.16 | 2026-06-21 | Padronizados enums de `entity_type`; removida relação duplicada `Fulfillment → WebhookEventLog`; ajustado o índice diagnóstico `WebhookEventLog.metadata.gelato_order_id`; formalizada a transição `ExchangeRequest.status = awaiting_posting` com instruções enviadas; adicionada regra para impedir reembolsos concorrentes `requested`/`processing` por `Payment`. |
| 1.15 | 2026-06-21 | Corrigida a especificação de `Payment` para suportar agregação financeira e validação de reembolso: adicionados `order_id`, `amount`, `captured_amount`, `currency_code`, `stripe_payment_intent_id`, `stripe_charge_id`, `stripe_event_id`, `payment_method_type` e `captured_at` como campos mínimos. Atualizadas regras, índices e metadados complementares. Declarada a Seção 4 como fonte canônica dos campos mínimos das entidades customizadas; a Seção 5 passa a ser complementar e não deve ser usada isoladamente como DDL. |
| 1.14 | 2026-06-21 | Adicionadas e consolidadas correções de consistência: `AnalyticsEventLog` para persistência de `purchase_completed`, `OperationalAlert` como entidade real, `Fulfillment.gelato_order_id` top-level, resolução de `not_started` como estado derivado, regras de override de troca, agregação financeira, bloqueio de reembolso acima do capturado, cardinalidades de logs e regras `DATA-001` a `DATA-110`. |
| 1.13 | 2026-06-21 | Verificadas e aplicadas as regras de integridade complementares exigidas pelo SRS/PRD Backend: `DATA-003` foi confirmada, `DATA-005` e `DATA-006` foram detalhadas com chaves de idempotência/unicidade, e `DATA-013` a `DATA-020` foram reservadas para as regras canônicas de criação de Order, Pix, `purchase_completed`, analytics, tracking, reembolso e uso de `completed`. Regras já existentes foram preservadas e renumeradas sem alterar sua semântica. |
| 1.12 | 2026-06-21 | Adicionada a entidade customizada `AdminActionLog` para auditar ações administrativas críticas executadas no Admin. A entidade registra `admin_id`, ação, entidade afetada, resultado, motivo, estados antes/depois, correlação operacional e metadados mínimos. Adicionadas relações, regras de integridade, índices e observações operacionais para cancelamentos, reembolsos, reprocessamentos Gelato, trocas e overrides administrativos. |
| 1.11 | 2026-06-21 | Adicionada a entidade customizada `EmailDeliveryLog` para registrar envios de e-mails transacionais, alertas operacionais, status de entrega via Resend, idempotência, falhas, retries e correlação com `Order`, `Refund`, `ExchangeRequest`, `Customer` e `OperationalAlert`. Adicionadas regras de integridade, cardinalidade, índices e observações operacionais. |
| 1.10 | 2026-06-21 | Atualizado `ExchangeRequest` para incluir status `canceled`, canal de solicitação, timestamps operacionais, campos de instruções/logística reversa, regras de primeira troca, troca adicional e registro manual/semiautomático via Correios. Adicionadas regras de integridade, cardinalidade, índices e observações operacionais. |
| 1.9 | 2026-06-21 | Atualizado `LineItem` para armazenar snapshot Gelato no momento de criação do `Order`, preservando `gelato_product_uid`, `gelato_template_id`, opções de variante, SKU de origem e `template_mode`. Adicionadas regras para impedir que alterações futuras em `ProductVariant` alterem pedidos já confirmados. |
| 1.8 | 2026-06-21 | Atualizado `Fulfillment` para suportar falhas, retries, idempotência, reprocessamento manual e atenção operacional. Adicionados campos de retry, erro, timestamps operacionais, chave de idempotência, motivo de atenção e regras de unicidade/estado para Gelato. |
| 1.7 | 2026-06-21 | Adicionada a entidade customizada `Refund` para registrar reembolsos totais e parciais iniciados pelo Admin e confirmados via webhook Stripe. Adicionadas relações com `Order`, `Payment`, `WebhookEventLog`, regras de integridade, metadados, índices e observações operacionais. |
| 1.6 | 2026-06-21 | Separado explicitamente o estado operacional do pedido (`order_status`) do estado financeiro (`payment_status`). Adicionadas regras para impedir que reembolso altere automaticamente `order_status`, para evitar uso precoce de `completed` e para alinhar `Order`, `Payment` e `Fulfillment` ao SRS v1.9. |
| 1.5 | 2026-06-21 | Adicionados `order_analytics_id` e `order_public_ref` ao `Order` para permitir eventos externos, analytics e referências públicas sem expor `order_id` interno. Adicionadas regras de geração, unicidade, uso em PostHog, restrições de privacidade e índices recomendados. |
| 1.4 | 2026-06-21 | Adicionada a entidade customizada `TrackingAccessToken` para permitir acesso anônimo seguro à página de tracking por clientes convidados. Adicionadas regras de hash de token, expiração, revogação, relações, índices e restrições de segurança. |
| 1.3 | 2026-06-21 | Adicionada a entidade customizada `WebhookEventLog` para registrar, auditar e tornar idempotente o processamento de webhooks Stripe e Gelato. Adicionadas relações, metadados, regras de integridade, índices e observações operacionais específicas para eventos externos. |
| 1.2 | 2026-06-21 | Adicionada a entidade customizada `CheckoutCompletionLog` para garantir idempotência na conclusão do checkout e criação do `Order` após webhook Stripe aprovado. Adicionadas relações, regras de integridade, índices e observações operacionais para evitar duplicidade de `Order`. |
| 1.1 | 2026-06-21 | Documento organizado e versionado. Adicionadas as entidades `PaymentCollection`, `PaymentSession` e `PaymentAttempt` para representar checkout/pagamento antes da criação do `Order`. Adicionadas relações e regras de integridade específicas para a camada pré-Order. |
| 1.0 | — | Versão inicial do modelo de dados. |

---

## 1. Objetivo

Este documento define o modelo lógico de dados para o e-commerce headless Print-on-Demand de camisetas.

O modelo deve orientar a implementação sobre:

- entidades nativas do Medusa;
- entidades customizadas;
- metadados obrigatórios;
- relações entre checkout, pagamento, pedido, itens, fulfillment, tracking e troca;
- snapshots de itens de pedido para fulfillment Gelato;
- ciclo operacional de trocas e logística reversa;
- entrega, auditoria, idempotência e reprocessamento de e-mails transacionais e alertas operacionais;
- auditoria de ações administrativas críticas executadas no Admin;
- persistência idempotente de eventos analíticos críticos, especialmente `purchase_completed`;
- alertas operacionais persistidos e auditáveis;
- identificadores seguros para analytics, tracking e referências públicas;
- regras de integridade necessárias para preservar o fluxo definido no SRS.

---

## 2. Premissas de Modelagem

### 2.1 Medusa como base transacional

As entidades nativas do Medusa devem ser reutilizadas sempre que possível. Entidades customizadas devem ser criadas apenas quando o core do Medusa não armazenar dados suficientes para atender aos requisitos do SRS e do PRD Backend.

### 2.2 Checkout pré-Order

Antes da confirmação confiável do pagamento por webhook Stripe, o sistema não deve criar `Order`.

Nesse estágio, o estado comercial deve permanecer associado a:

- `Cart`;
- `PaymentCollection`;
- `PaymentSession`;
- `PaymentAttempt`;
- `PaymentIntent` Stripe.

### 2.3 Order pós-pagamento

O `Order` Medusa deve ser criado somente após webhook Stripe canônico aprovado. Depois da criação/confirmação do `Order`, o backend deve registrar duravelmente `purchase_completed` em `AnalyticsEventLog` como evento de domínio/outbox local e enfileirar a entrega assíncrona ao PostHog. O fulfillment Gelato pode iniciar após existir registro local durável de `purchase_completed` para o respectivo `Order`; ele não deve depender de `AnalyticsEventLog.status = sent` nem do sucesso da entrega ao PostHog.

### 2.4 Entidades customizadas

Entidades customizadas devem seguir as seguintes regras:

- usar IDs próprios e estáveis;
- manter referência ao ID Medusa quando aplicável;
- manter referência externa quando houver integração;
- registrar `created_at` e `updated_at`;
- não armazenar secrets, dados completos de cartão ou tokens sensíveis em texto puro.

### 2.5 Idempotência da conclusão do checkout

A conclusão do checkout e criação do `Order` após webhook Stripe aprovado deve ser idempotente.

A implementação deve registrar uma chave única por operação, preferencialmente:

- `payment_intent_id`; ou
- `cart_id + payment_intent_id`.

Essa regra evita criação duplicada de `Order` quando houver reentrega de webhook, retry interno, timeout parcial ou tentativa concorrente de processar o mesmo pagamento confirmado.

### 2.6 Auditoria e idempotência de webhooks externos

Todo webhook externo relevante deve ser registrado antes ou durante seu processamento em `WebhookEventLog`.

Essa entidade deve:

- registrar eventos Stripe e Gelato recebidos;
- permitir idempotência por ID externo do evento quando disponível;
- calcular e persistir `deduplication_key` canônica para todo webhook relevante;
- permitir fallback por hash normalizado do payload ou chave determinística equivalente quando o provedor não fornecer ID confiável;
- separar o registro de recebimento do webhook da operação interna executada por ele;
- impedir que reentregas do mesmo webhook dupliquem criação de `Order`, fulfillment, tracking, e-mails ou reembolsos.

A deduplicação efetiva deve ser garantida por constraint única em `provider + deduplication_key`. `payload_hash` pode compor a chave quando não houver `external_event_id` confiável, mas `payload_hash` isolado não deve ser tratado apenas como índice comum para deduplicação.

`WebhookEventLog` não substitui `CheckoutCompletionLog`. O primeiro controla o recebimento/processamento de eventos externos; o segundo controla especificamente a operação interna de concluir checkout e criar `Order`.

### 2.7 Tracking anônimo seguro

Pedidos de convidados devem ser acessados para tracking por link com token seguro, validado server-side.

O sistema não deve persistir token em texto puro. A persistência deve usar `TrackingAccessToken.token_hash`, com expiração e possibilidade de revogação.

O token deve ser incluído no e-mail de confirmação e no e-mail de envio/rastreio, conforme a regra funcional de tracking anônimo. Cliente autenticado deve consultar tracking pela área do cliente, sem depender de token de link.

### 2.8 Identificadores públicos e analíticos do pedido

O `order_id` interno do Medusa não deve ser enviado para ferramentas externas de analytics nem usado como identificador público de consulta anônima.

Cada `Order` deve possuir identificadores seguros para finalidades distintas:

- `order_analytics_id`: identificador não reversível para eventos externos, especialmente PostHog e `purchase_completed`.
- `order_public_ref`: referência pública legível para comunicação com o cliente e suporte, sem substituir autorização server-side.

Esses identificadores não substituem `TrackingAccessToken` para acesso anônimo ao tracking. Links de tracking para convidados continuam exigindo token seguro validado server-side.

### 2.9 Separação entre estado operacional e estado financeiro

O modelo deve separar explicitamente o estado operacional do pedido e o estado financeiro do pagamento.

- `order_status` representa o ciclo operacional do pedido: confirmação, fulfillment, envio, entrega, conclusão, cancelamento ou necessidade de atenção administrativa.
- `payment_status` representa o estado financeiro associado ao pedido: pagamento capturado, reembolso total ou reembolso parcial.

Reembolso total ou parcial não deve alterar automaticamente `order_status` para `canceled`. Cancelamento é uma decisão operacional própria, normalmente iniciada pelo Admin e sujeita ao estado da Gelato.

O estado `completed` não deve ser usado apenas porque o pedido foi despachado. Pedido despachado deve usar `order_status = shipped`; `completed` só deve ser usado após entrega confirmada ou fechamento operacional explícito pós-entrega.

Estados financeiros anteriores à criação do `Order`, como Pix pendente, pagamento expirado, pagamento falho ou sessão de pagamento cancelada, pertencem a `PaymentAttempt`, `PaymentSession` e `PaymentCollection`, não a `Order`.


### 2.10 Reembolsos

Reembolsos devem ser modelados como entidade própria `Refund`, separada de `Order` e `Payment`.

A solicitação de reembolso pode ser iniciada pelo Admin, mas o estado financeiro local só deve ser considerado concluído após confirmação confiável do Stripe por webhook canônico.

Reembolso total ou parcial deve atualizar registros financeiros, mas não deve alterar automaticamente o ciclo operacional do pedido. Portanto:

- `Refund.status` registra o ciclo do reembolso;
- `Refund.status = succeeded` é a fonte de verdade para valores reembolsados confirmados;
- `Payment.status` e `Order.payment_status` podem ser persistidos como campos derivados/denormalizados para consulta, filtro e relatórios, mas devem ser recalculados a partir de `Payment.captured_amount` e da soma de `Refund.amount` com `status = succeeded`;
- a confirmação de um reembolso via webhook Stripe deve recalcular `Payment.status` e `Order.payment_status` na mesma transação lógica em que o `Refund` é marcado como `succeeded`;
- nenhuma alteração manual isolada em `Payment.status` ou `Order.payment_status` deve ocorrer sem recomputação financeira;
- valores financeiros devem ser inteiros expressos na menor unidade monetária da moeda;
- `Payment.amount` e `Payment.captured_amount` devem ser não negativos, e `Payment.captured_amount` não pode exceder `Payment.amount`;
- `Refund.amount` deve ser positivo, `Refund.currency_code` deve ser igual a `Payment.currency_code` e o valor solicitado não pode exceder o saldo capturado disponível;
- no MVP, `Payment.currency_code` e `Refund.currency_code` devem ser `BRL`;
- `Order.order_status` preserva o estado operacional real do pedido.

### 2.11 Fulfillment, retries e atenção operacional

O fulfillment Gelato deve ser modelado como ciclo operacional controlado, não apenas como metadata simples dentro do pedido.

A entidade `Fulfillment` deve registrar:

- referência externa Gelato;
- status interno do fulfillment;
- chave de idempotência;
- tentativas de criação/reprocessamento;
- último erro recuperável ou irrecuperável;
- motivo de atenção operacional;
- timestamps de submissão, falha, cancelamento, envio e entrega quando disponíveis.

Falhas persistentes na criação ou atualização do fulfillment devem permitir que o pedido vá para `Order.order_status = requires_attention`, sem recriar o `Order`, sem perder o pagamento confirmado e sem duplicar pedido ativo na Gelato.

### 2.12 Snapshot Gelato no LineItem

O `LineItem` do `Order` deve preservar um snapshot dos metadados Gelato relevantes no momento da criação/confirmação do pedido.

Esse snapshot deve ser copiado a partir de `ProductVariant.metadata` e deve conter, no mínimo:

- `gelato_product_uid`;
- `gelato_template_id`;
- opções Gelato de variante, como tamanho e cor;
- `template_mode`;
- SKU e ID da variante de origem;
- timestamp de captura do snapshot.

Depois que o `Order` for criado, alterações futuras em `ProductVariant.metadata` não podem modificar semanticamente os itens de pedidos já confirmados. O payload de criação Gelato para um pedido existente deve usar o snapshot persistido no `LineItem`, não os metadados atuais da variante.

### 2.13 Trocas e logística reversa

Solicitações de troca devem ser modeladas como registros operacionais próprios em `ExchangeRequest`, sempre associadas a um `Order` existente.

No MVP, o cliente solicita troca pelo canal canônico de e-mail de suporte. Formulário ou página de contato pode existir como canal opcional, mas não substitui a regra de que o registro formal da troca é criado ou validado pelo Admin.

O processo de logística reversa dos Correios no MVP é manual ou semiautomático: o admin gera ou obtém código, prazo e instruções fora do sistema, registra esses dados no Admin e o sistema armazena o histórico e envia as instruções ao cliente. Integração automatizada via API dos Correios fica fora do MVP.

A primeira troca da compra deve ter frete de retorno pago pela empresa. Trocas adicionais da mesma compra devem ter frete pago pelo cliente.

### 2.14 E-mails transacionais e alertas operacionais

E-mails transacionais e alertas operacionais devem ser modelados como registros auditáveis em `EmailDeliveryLog`.

A entidade deve registrar:

- e-mails de confirmação de pedido;
- e-mails de envio/rastreio;
- e-mails de cancelamento;
- e-mails de reembolso;
- e-mails de boas-vindas e redefinição de senha;
- e-mails de instruções de troca/logística reversa;
- alertas operacionais críticos enviados ao Admin.

Falha no envio de e-mail não deve cancelar pedido pago nem desfazer transições de negócio já confirmadas. E-mails devem ser idempotentes por entidade e tipo, reprocessáveis quando houver falha e auditáveis por status de envio.

Logs de entrega de e-mail não devem armazenar secrets, token de tracking em texto puro, dados completos de pagamento ou corpo integral com dados sensíveis. Quando um e-mail contiver link de tracking, o log deve referenciar `tracking_token_id` ou entidade relacionada, não o token puro.

### 2.15 Auditoria administrativa

Ações administrativas críticas executadas no Admin devem ser registradas em `AdminActionLog`.

A entidade deve registrar, no mínimo:

- administrador responsável;
- ação executada;
- entidade afetada;
- resultado da ação;
- motivo ou justificativa quando aplicável;
- estados relevantes antes e depois;
- correlação com logs, webhooks, e-mails, fulfillment, reembolso ou troca quando aplicável.

`AdminActionLog` não substitui as entidades de domínio. O estado verdadeiro de pedido, reembolso, fulfillment ou troca continua nas respectivas entidades (`Order`, `Refund`, `Fulfillment`, `ExchangeRequest`). O log administrativo serve para auditoria, rastreabilidade, suporte operacional e investigação de incidentes.

A entidade também não substitui `WebhookEventLog` nem `EmailDeliveryLog`: webhooks externos e entregas de e-mail continuam auditados nas entidades próprias.

---

### 2.16 Eventos analíticos e alertas operacionais persistidos

Eventos analíticos críticos enviados a provedores externos devem ser persistidos de forma idempotente em `AnalyticsEventLog`. Alertas operacionais críticos devem ser persistidos em `OperationalAlert`, mesmo quando também forem enviados por e-mail.


### 2.17 Convenção canônica de `entity_type`

Campos polimórficos chamados `entity_type` devem usar nomes canônicos, sem aliases informais.

Valores canônicos recomendados para esta versão:

```text
cart
payment_collection
payment_session
payment_attempt
checkout_completion
order
payment
refund
fulfillment
exchange_request
customer
product
product_variant
email_delivery_log
analytics_event_log
webhook_event_log
operational_alert
auth
tracking
system
unknown
other
```

Regras:

- Usar `exchange_request`, não `exchange`.
- Usar `operational_alert`, não `alert`.
- Quando uma entidade de log apontar para uma entidade principal, usar `entity_type + entity_id` com um dos nomes canônicos acima.
- Aliases antigos podem ser tratados em migração, mas não devem ser usados em novos registros.

### 2.18 Fronteira entre `PaymentSession` e `PaymentAttempt`

`PaymentSession` e `PaymentAttempt` não são entidades equivalentes. Elas existem em camadas diferentes do modelo.

- `PaymentSession` representa o estado do provedor de pagamento dentro do fluxo Medusa/Stripe. Deve conter dados mínimos da sessão/provedor, como `provider_id`, `payment_collection_id`, status do provedor e metadados não sensíveis.
- `PaymentAttempt` é o registro operacional customizado da loja. Deve concentrar correlação com `cart_id`, `payment_intent_id`, retorno assíncrono, UX de confirmação, idempotência de criação do `Order` e vínculo posterior com `CheckoutCompletionLog`.
- Estados de UX, como `pix_qr_displayed`, `awaiting_pix_payment`, `pix_expired` e `card_client_confirmed`, pertencem a `PaymentAttempt.client_confirmation_state`, não à fonte financeira canônica.
- A fonte de verdade financeira continua sendo o webhook Stripe canônico registrado em `WebhookEventLog` e processado pelo backend.
- `PaymentSession` pode ser substituída, recriada ou controlada pelo Medusa/provedor; `PaymentAttempt` deve preservar a trilha operacional da tentativa relevante para o domínio da loja.

## 3. Entidades Principais

### 3.1 Catálogo

| Entidade | Origem | Campos Relevantes | Observações |
|---|---|---|---|
| `Product` | Medusa | `id`, `title`, `description`, `status`, `thumbnail`, `metadata` | Representa uma camiseta. |
| `ProductVariant` | Medusa | `id`, `sku`, `title`, `options`, `prices`, `metadata` | Representa combinação de tamanho/cor. Deve conter metadados Gelato obrigatórios. |
| `ProductImage` | Medusa/Supabase | `id`, `url`, `product_id`, `metadata` | URL deve apontar para Supabase Storage ou CDN derivada. |

### 3.2 Checkout e Pagamento Pré-Order

| Entidade | Origem | Campos Relevantes | Observações |
|---|---|---|---|
| `Cart` | Medusa | `id`, `items`, `email`, `shipping_address`, `region_id`, `metadata` | Base do checkout. Existe antes do pagamento confirmado e antes do `Order`. |
| `LineItem` | Medusa | `variant_id`, `quantity`, `unit_price`, `metadata.gelato_snapshot` | Representa item do carrinho/pedido. No `Order`, deve preservar snapshot Gelato usado para fulfillment, independente de alterações futuras na variante. |
| `PaymentCollection` | Medusa | `id`, `cart_id`, `amount`, `currency_code`, `status`, `metadata` | Representa a coleção de pagamento vinculada ao carrinho antes da criação do `Order`. |
| `PaymentSession` | Medusa/Stripe | `id`, `payment_collection_id`, `provider_id`, `amount`, `currency_code`, `status`, `metadata` | Representa a sessão de pagamento com o provedor. Pode representar cartão ou Pix. |
| `PaymentAttempt` | Custom | `id`, `cart_id`, `payment_collection_id`, `payment_session_id`, `stripe_payment_intent_id`, `payment_method_type`, `status`, `amount`, `currency_code`, `metadata` | Registro operacional da tentativa de pagamento. Necessário para correlacionar carrinho, PaymentIntent, status e retorno assíncrono antes do `Order`. |
| `CheckoutCompletionLog` | Custom | `id`, `operation`, `idempotency_key`, `cart_id`, `payment_intent_id`, `payment_attempt_id`, `order_id`, `status`, `metadata` | Registro idempotente da operação de concluir checkout/criar `Order` após webhook Stripe aprovado. Impede criação duplicada de `Order`. |

### 3.3 Cliente e Endereço

| Entidade | Origem | Campos Relevantes | Observações |
|---|---|---|---|
| `Customer` | Medusa | `id`, `email`, `first_name`, `last_name`, `phone` | Opcional para guest checkout. |
| `Address` | Medusa | `name`, `address_1`, `address_2`, `city`, `province`, `postal_code`, `country_code`, `phone` | Obrigatório para envio no Brasil. |

### 3.4 Pedido, Pagamento, Fulfillment e Tracking

| Entidade | Origem | Campos Relevantes | Observações |
|---|---|---|---|
| `Order` | Medusa | `id`, `display_id`, `email`, `items`, `shipping_address`, `total`, `order_status`, `payment_status`, `order_analytics_id`, `order_public_ref`, `metadata` | Criado somente após pagamento confirmado por webhook Stripe. Deve separar estado operacional (`order_status`) de estado financeiro (`payment_status`) e possuir identificadores seguros para analytics e referência pública sem expor `order_id` interno. |
| `Payment` | Medusa/Stripe | `id`, `order_id`, `provider_id`, `status`, `amount`, `captured_amount`, `currency_code`, `stripe_payment_intent_id`, `stripe_charge_id`, `stripe_event_id`, `payment_method_type`, `captured_at`, `metadata` | Representa o registro financeiro associado ao `Order` após confirmação. Deve conter valor capturado, referência Stripe, método usado e vínculo explícito ao `Order`. Seu status não deve ser confundido com `order_status`. |
| `Refund` | Custom/Stripe | `id`, `order_id`, `payment_id`, `stripe_refund_id`, `amount`, `currency_code`, `status`, `requested_by_admin_id`, `reason`, `metadata` | Registro financeiro-operacional de reembolso total ou parcial. Criado quando o Admin solicita reembolso e confirmado somente após webhook Stripe confiável. |
| `Fulfillment` | Medusa/Gelato | `id`, `order_id`, `status`, `gelato_order_id`, `tracking_numbers`, `metadata` | Deve conter referência Gelato top-level, chave de idempotência, dados de tracking, retry, último erro e motivo de atenção operacional quando aplicável. |
| `TrackingAccessToken` | Custom | `id`, `order_id`, `token_hash`, `expires_at`, `last_used_at`, `revoked_at`, `metadata` | Token seguro para acesso anônimo ao tracking de pedidos de convidados. Persistir apenas hash, nunca o token puro. |
| `ShippingOption` | Medusa/Gelato | `id`, `name`, `amount`, `metadata` | Deve mapear opção de frete. |
| `Promotion` | Medusa | `code`, `type`, `value`, `usage_limit` | Cupons e descontos. |

### 3.5 Trocas e Operação

| Entidade | Origem | Campos Relevantes | Observações |
|---|---|---|---|
| `ExchangeRequest` | Custom/Medusa Extension | `id`, `order_id`, `exchange_number_for_order`, `status`, `reason`, `requested_channel`, `shipping_cost_owner`, `provider`, `reverse_logistics_code`, `correios_deadline`, `instructions`, `metadata` | Registro operacional de troca e logística reversa. Criado/validado pelo Admin após solicitação do cliente. |
| `OperationalAlert` | Custom | `id`, `severity`, `type`, `entity_type`, `entity_id`, `message`, `status`, `sent_at`, `acknowledged_at`, `resolved_at`, `metadata` | Entidade persistida para alertas críticos operacionais. Pode gerar `EmailDeliveryLog`, mas não é substituída por e-mail ou log textual. |
| `AdminActionLog` | Custom/Admin | `id`, `admin_id`, `action`, `entity_type`, `entity_id`, `result`, `reason`, `metadata`, `created_at` | Registro auditável de ações administrativas críticas executadas no Admin, sem substituir entidades de domínio. |

### 3.6 Comunicação Transacional

| Entidade | Origem | Campos Relevantes | Observações |
|---|---|---|---|
| `EmailDeliveryLog` | Custom/Resend | `id`, `entity_type`, `entity_id`, `email_type`, `recipient`, `provider`, `resend_message_id`, `status`, `idempotency_key`, `retry_count`, `metadata` | Registro auditável de e-mails transacionais e alertas operacionais. Usado para idempotência, reprocessamento, diagnóstico de falhas e correlação com entidades de negócio. |

### 3.7 Webhooks e Auditoria Técnica

| Entidade | Origem | Campos Relevantes | Observações |
|---|---|---|---|
| `WebhookEventLog` | Custom | `id`, `provider`, `external_event_id`, `event_type`, `entity_type`, `entity_id`, `payload_hash`, `deduplication_key`, `status`, `metadata` | Registro técnico de eventos externos Stripe/Gelato. Usado para auditoria, idempotência e diagnóstico de processamento de webhooks. |
| `AnalyticsEventLog` | Custom | `id`, `event_name`, `provider`, `entity_type`, `entity_id`, `order_id`, `order_analytics_id`, `idempotency_key`, `payload_hash`, `status`, `metadata` | Registro idempotente de eventos analíticos externos, especialmente `purchase_completed`. |

---

## 4. Entidades Customizadas e Identificadores Complementares

Esta seção detalha entidades customizadas, extensões de entidades Medusa e identificadores complementares adicionados ao modelo entre as versões 1.1 e 1.20. A Seção 4 é a fonte canônica dos campos mínimos das entidades customizadas e extensões controladas. A Seção 5 lista metadados obrigatórios, estruturas JSON e espelhos complementares, mas não deve ser usada isoladamente como DDL quando divergir da Seção 4.

### 4.1 PaymentCollection

Representa a coleção de pagamento associada ao carrinho antes da criação do `Order`.

#### Finalidade

- Agrupar sessões/tentativas de pagamento do checkout.
- Manter valor total esperado.
- Relacionar o pagamento ao `Cart`.
- Permitir que o checkout exista sem criar `Order`.

#### Campos mínimos

```json
{
  "id": "string",
  "cart_id": "string",
  "amount": 0,
  "currency_code": "BRL",
  "status": "pending | authorized | captured | failed | canceled",
  "metadata": {
    "checkout_reference": "string"
  },
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

#### Regras

- Deve existir antes de criar `PaymentSession`.
- Deve estar vinculada a um `Cart`.
- Não representa `Order`.
- Não deve iniciar fulfillment.

---

### 4.2 PaymentSession

Representa a sessão de pagamento criada para um provedor específico, inicialmente Stripe.

#### Finalidade

- Registrar provedor de pagamento.
- Relacionar `PaymentCollection` com Stripe.
- Suportar cartão e Pix.
- Armazenar metadados não sensíveis do provedor.

#### Campos mínimos

```json
{
  "id": "string",
  "payment_collection_id": "string",
  "provider_id": "stripe",
  "amount": 0,
  "currency_code": "BRL",
  "status": "pending | requires_action | processing | authorized | captured | failed | canceled | expired",
  "metadata": {
    "stripe_payment_intent_id": "string",
    "payment_method_type": "card | pix"
  },
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

#### Regras

- Deve pertencer a uma `PaymentCollection`.
- Pode haver mais de uma sessão/tentativa ao longo do checkout, por exemplo quando o cliente troca de método de pagamento.
- `PaymentSession` representa a camada Medusa/provedor; não deve concentrar regras de domínio como idempotência de criação do `Order`, estado de confirmação assíncrona da storefront ou histórico operacional da tentativa.
- Dados sensíveis de cartão não devem ser armazenados.
- Status client-side não deve ser tratado como fonte de verdade financeira.

---

### 4.3 PaymentAttempt

Entidade customizada recomendada para rastrear cada tentativa de pagamento do checkout.

#### Finalidade

- Correlacionar `cart_id`, `payment_collection_id`, `payment_session_id` e `stripe_payment_intent_id`.
- Suportar retorno assíncrono do checkout.
- Permitir que a storefront consulte o estado “confirmando pagamento e pedido”.
- Registrar tentativas Pix pendentes, expiradas, falhas ou confirmadas sem criar `Order` antes da hora.

#### Campos mínimos

```json
{
  "id": "string",
  "cart_id": "string",
  "payment_collection_id": "string",
  "payment_session_id": "string",
  "stripe_payment_intent_id": "string",
  "payment_method_type": "card | pix",
  "status": "pending | awaiting_pix_payment | processing | captured | failed | expired | canceled",
  "amount": 0,
  "currency_code": "BRL",
  "order_id": "string | null",
  "last_stripe_event_id": "string | null",
  "client_confirmation_state": "pix_qr_displayed | awaiting_pix_payment | pix_expired | card_client_confirmed | null",
  "metadata": {},
  "created_at": "datetime",
  "updated_at": "datetime",
  "confirmed_at": "datetime | null",
  "expired_at": "datetime | null",
  "failed_at": "datetime | null"
}
```

#### Regras

- `PaymentAttempt` representa a camada operacional customizada da loja; deve ser a entidade usada para retorno assíncrono, estado de UX, correlação com `CheckoutCompletionLog` e prevenção de criação duplicada de `Order`.
- `order_id` deve permanecer `null` até o webhook Stripe aprovado concluir o checkout e criar o `Order`.
- `stripe_payment_intent_id` deve ser único quando não nulo. Uma nova tentativa de pagamento deve gerar novo PaymentIntent.
- Para idempotência de criação de `Order`, a implementação deve conseguir localizar a tentativa por `stripe_payment_intent_id` ou `cart_id + stripe_payment_intent_id`.
- Pix pendente, expirado, cancelado ou falho não pode criar `Order`.
- `client_confirmation_state` é label de UX, não estado financeiro canônico.

---

### 4.4 CheckoutCompletionLog

Entidade customizada responsável por registrar, travar e auditar a operação de conclusão do checkout e criação do `Order`.

#### Finalidade

- Garantir que o mesmo pagamento confirmado não crie mais de um `Order`.
- Permitir retries seguros quando o webhook Stripe for entregue mais de uma vez.
- Registrar falhas parciais entre pagamento aprovado, conclusão do checkout e persistência do `Order`.
- Correlacionar `Cart`, `PaymentAttempt`, `PaymentIntent` Stripe e `Order` final.

#### Campos mínimos

```json
{
  "id": "string",
  "operation": "complete_checkout_create_order",
  "idempotency_key": "payment_intent_id | cart_id + payment_intent_id",
  "cart_id": "string",
  "payment_intent_id": "string",
  "payment_attempt_id": "string | null",
  "order_id": "string | null",
  "status": "processing | completed | failed",
  "error_code": "string | null",
  "error_message": "string | null",
  "metadata": {
    "stripe_event_id": "string",
    "payment_method_type": "card | pix"
  },
  "created_at": "datetime",
  "updated_at": "datetime",
  "locked_at": "datetime | null",
  "completed_at": "datetime | null",
  "failed_at": "datetime | null"
}
```

#### Regras

- `idempotency_key` deve ser única.
- A chave recomendada é `payment_intent_id`; quando houver risco de colisão operacional, usar `cart_id + payment_intent_id`.
- Apenas um registro `completed` pode existir para o mesmo `payment_intent_id`.
- Se o webhook Stripe for reentregue e já houver `CheckoutCompletionLog.status = completed`, a implementação deve retornar o `order_id` existente e não criar novo `Order`.
- Se o status estiver `processing`, a implementação deve respeitar lock/transação para evitar execução concorrente.
- Se o status estiver `failed`, a operação pode ser reprocessada usando a mesma chave, desde que nenhum `Order` já tenha sido criado.
- A criação do `Order`, o preenchimento de `order_id` no `CheckoutCompletionLog` e a atualização do `PaymentAttempt.order_id` devem ocorrer de forma transacional sempre que possível.
- Esta entidade não substitui o log de webhook. Ela representa a idempotência da operação interna de conclusão do checkout.

---

### 4.5 WebhookEventLog

Entidade customizada responsável por registrar eventos externos recebidos de provedores como Stripe e Gelato.

#### Finalidade

- Registrar todo webhook relevante recebido pelo backend.
- Garantir idempotência no processamento de webhooks externos.
- Auditar eventos processados, ignorados, duplicados ou falhos.
- Correlacionar eventos externos com entidades internas como `PaymentAttempt`, `CheckoutCompletionLog`, `Order`, `Payment`, `Fulfillment` e `Refund`.
- Permitir diagnóstico de reentregas, falhas parciais, payloads inválidos e eventos fora de ordem.

#### Campos mínimos

```json
{
  "id": "string",
  "provider": "stripe | gelato",
  "external_event_id": "string | null",
  "event_type": "string",
  "entity_type": "cart | payment_attempt | checkout_completion | order | payment | fulfillment | refund | exchange_request | unknown",
  "entity_id": "string | null",
  "payload_hash": "string",
  "deduplication_key": "string",
  "status": "received | processing | processed | ignored | failed",
  "processing_attempts": 0,
  "error_code": "string | null",
  "error_message": "string | null",
  "metadata": {
    "stripe_payment_intent_id": "string | null",
    "gelato_order_id": "string | null",
    "idempotency_key": "string | null",
    "correlation_id": "string | null"
  },
  "received_at": "datetime",
  "processed_at": "datetime | null",
  "ignored_at": "datetime | null",
  "failed_at": "datetime | null",
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

#### Regras

- `provider` deve indicar o provedor externo que originou o evento.
- `external_event_id` deve ser persistido quando o provedor fornecer ID confiável.
- Para Stripe, a chave de deduplicação preferencial deve derivar de `external_event_id` confiável.
- Para Gelato, quando não houver ID de evento confiável, a chave de deduplicação deve derivar de `payload_hash` normalizado ou de outra chave determinística equivalente validada na integração.
- `deduplication_key` é obrigatória para webhooks relevantes e deve ser persistida antes de executar efeitos de negócio.
- `provider + deduplication_key` deve ser único e deve ser a constraint canônica para impedir processamento duplicado.
- `payload_hash` deve ser calculado a partir de representação normalizada do payload recebido, não deve conter secrets e pode ser usado como insumo para `deduplication_key` quando `external_event_id` não for confiável.
- `payload_hash` isolado é campo de diagnóstico e correlação; não deve ser a única proteção se não houver constraint única associada à chave de deduplicação.
- `WebhookEventLog.metadata.gelato_order_id`, quando persistido, é dado diagnóstico do payload recebido. Lookup canônico de fulfillment deve usar `Fulfillment.gelato_order_id`, não o campo em `metadata`.
- Eventos duplicados devem ser marcados como `ignored` ou reutilizar o processamento anterior sem efeitos colaterais.
- `WebhookEventLog.status = processed` indica que o processamento mínimo seguro foi concluído.
- `WebhookEventLog.status = failed` deve preservar `error_code` e `error_message` para diagnóstico e possível reprocessamento.
- O log de webhook não deve armazenar dados completos de cartão, secrets, tokens sensíveis ou payloads brutos com dados excessivos.
- `WebhookEventLog` não substitui entidades de negócio. Ele registra o evento externo e sua correlação com a entidade interna afetada.
- `WebhookEventLog` não substitui `CheckoutCompletionLog`; webhooks Stripe aprovados podem acionar ambos: o primeiro para registrar o evento externo, o segundo para controlar a criação idempotente do `Order`.

---

### 4.6 TrackingAccessToken

Entidade customizada responsável por permitir acesso anônimo seguro à página de tracking para pedidos de convidados.

#### Finalidade

- Permitir que cliente convidado acompanhe o pedido por link enviado por e-mail.
- Evitar consulta anônima de pedidos apenas por `order_id`, `display_id` ou identificador público previsível.
- Persistir apenas hash do token, nunca o token puro.
- Controlar expiração, revogação e uso do token.
- Separar tracking anônimo de tracking autenticado na área do cliente.

#### Campos mínimos

```json
{
  "id": "string",
  "order_id": "string",
  "token_hash": "string",
  "purpose": "guest_tracking",
  "expires_at": "datetime",
  "last_used_at": "datetime | null",
  "revoked_at": "datetime | null",
  "metadata": {
    "created_reason": "order_confirmation | token_rotation | admin_reissue",
    "created_by": "system | admin"
  },
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

#### Regras

- O token puro deve ser gerado com entropia suficiente e exibido/enviado apenas no link ao cliente.
- O banco deve persistir somente `token_hash`.
- `token_hash` deve ser único.
- O token deve estar vinculado a exatamente um `Order`.
- O token deve expirar 365 dias após confirmação do pedido, salvo decisão operacional posterior mais restritiva.
- Token expirado, revogado, ausente ou inválido deve retornar erro genérico, sem expor existência ou dados do pedido.
- Cliente autenticado deve acessar tracking pela área do cliente, validando posse do pedido, sem exigir `TrackingAccessToken`.
- Um pedido pode ter mais de um token ao longo do tempo para rotação, reemissão ou revogação, mas apenas tokens não expirados e não revogados devem ser aceitos.
- Links de tracking enviados por e-mail devem usar o token puro apenas na URL; logs, analytics e Sentry não devem capturar esse valor.
- Eventos externos de analytics devem usar `tracking_ref` ou identificador público/anônimo não reversível, não `token_hash` e não token puro.

---

### 4.7 Identificadores Complementares do Order

Campos complementares adicionados ao `Order` para separar identificadores internos, públicos e analíticos.

#### Finalidade

- Permitir emissão de `purchase_completed` no backend sem enviar `order_id` interno ao PostHog.
- Permitir comunicação com cliente e suporte usando referência pública não sensível.
- Evitar acoplamento entre ferramentas externas e IDs internos do Medusa/banco.
- Preservar `TrackingAccessToken` como mecanismo obrigatório para tracking anônimo de convidados.

#### Campos mínimos

```json
{
  "order_analytics_id": "string",
  "order_public_ref": "string"
}
```

#### Regras

- `order_analytics_id` deve ser gerado no momento da criação/confirmação do `Order` ou imediatamente antes da emissão de `purchase_completed`.
- `order_analytics_id` deve ser único, não reversível e adequado para envio a ferramentas externas de analytics.
- `order_public_ref` deve ser único no contexto operacional da loja e pode ser exibido ao cliente em e-mails, confirmação de pedido e suporte.
- `order_public_ref` não deve permitir consulta anônima de pedido sem autorização adicional.
- `order_id` interno do Medusa não deve ser enviado ao PostHog ou a eventos externos de analytics.
- `purchase_completed` deve usar `order_analytics_id` ou `order_public_ref` seguro no payload externo.
- `TrackingAccessToken` continua obrigatório para acesso anônimo ao tracking por cliente convidado.

---

### 4.8 Estados do Order: operacional vs financeiro

Campos complementares de status adicionados ao `Order` para separar estado operacional e estado financeiro.

#### Finalidade

- Evitar que reembolsos alterem indevidamente o ciclo operacional do pedido.
- Evitar que `completed` seja usado no momento do despacho.
- Permitir que Admin, integrações e relatórios filtrem pedidos por estado operacional e financeiro de forma independente.
- Alinhar `Order`, `Payment` e `Fulfillment` aos estados definidos no SRS v1.9.

#### Campos mínimos

```json
{
  "order_status": "confirmed | in_fulfillment | shipped | delivered | completed | canceled | requires_attention",
  "payment_status": "captured | refunded | partially_refunded"
}
```

#### Semântica de `order_status`

| Estado | Significado |
|---|---|
| `confirmed` | Order criado após webhook Stripe aprovado. Fulfillment ainda não iniciado ou ainda não refletido no estado operacional. |
| `in_fulfillment` | Pedido em produção/envio pela Gelato ou workflow equivalente. |
| `shipped` | Pedido despachado; tracking disponível ou envio confirmado. Produto ainda pode estar em trânsito. |
| `delivered` | Pedido entregue ao cliente, quando evento de entrega estiver disponível. |
| `completed` | Ciclo operacional encerrado após entrega confirmada ou fechamento administrativo pós-entrega. Não deve ser usado apenas por envio despachado. |
| `canceled` | Pedido cancelado por decisão operacional/admin, respeitando regras de cancelamento e estado da Gelato. |
| `requires_attention` | Pedido exige intervenção administrativa, por falha de fulfillment, metadados inválidos ou inconsistência operacional. |

#### Semântica de `payment_status`

| Estado | Significado |
|---|---|
| `captured` | Pagamento confirmado/capturado por webhook Stripe canônico. |
| `refunded` | Pagamento totalmente reembolsado após confirmação por webhook Stripe. |
| `partially_refunded` | Pagamento parcialmente reembolsado após confirmação por webhook Stripe. |

#### Agregação de `payment_status`

`Order.payment_status` é um estado agregado derivado dos pagamentos capturados e dos reembolsos confirmados. A regra de cálculo deve ser:

- Se nenhum pagamento foi capturado: o estado não se aplica ao `Order`, pois `Order` não deve existir antes de pagamento confirmado.
- Se `total_reembolsado_confirmado = 0`: `payment_status = captured`.
- Se `0 < total_reembolsado_confirmado < total_capturado`: `payment_status = partially_refunded`.
- Se `total_reembolsado_confirmado >= total_capturado`: `payment_status = refunded`.

Somente `Refund.status = succeeded` entra no cálculo de valor reembolsado confirmado. `Refund` com status `requested`, `processing`, `failed` ou `canceled` não altera `Order.payment_status`.

#### Fonte de verdade e recomputação transacional

`Refund` é a fonte de verdade para reembolsos confirmados. O evento financeiro confiável é a transição para `Refund.status = succeeded`, aplicada somente após confirmação por webhook Stripe canônico.

`Payment.status` e `Order.payment_status` podem ser persistidos como campos denormalizados para simplificar consultas, filtros do Admin e relatórios operacionais. Mesmo persistidos, esses campos não são fonte primária de verdade para reembolsos: devem ser recalculados a partir de `Payment.captured_amount` e da soma de `Refund.amount` com `status = succeeded`.

A mesma transação lógica que marca `Refund.status = succeeded` deve recalcular e persistir:

- `Payment.status`;
- `Order.payment_status`;
- timestamps e metadados financeiros relacionados, quando aplicável.

Nenhuma rotina administrativa, script de suporte, correção manual ou webhook deve alterar isoladamente `Payment.status` ou `Order.payment_status` sem recomputar o agregado financeiro. Caso a recomputação falhe, o sistema deve preservar o estado anterior, registrar erro e, quando aplicável, gerar alerta operacional.

#### Campos financeiros mínimos de `Payment`

Para que a agregação de `Order.payment_status` e o bloqueio de reembolso acima do capturado sejam verificáveis, `Payment` deve expor explicitamente os campos financeiros abaixo. Esses campos são canônicos para o modelo lógico, mesmo que a implementação Medusa persista parte deles em tabelas nativas ou metadata controlada.

```json
{
  "id": "string",
  "order_id": "string",
  "provider_id": "stripe",
  "status": "captured | refunded | partially_refunded",
  "amount": 0,
  "captured_amount": 0,
  "currency_code": "BRL",
  "stripe_payment_intent_id": "string",
  "stripe_charge_id": "string | null",
  "stripe_event_id": "string",
  "payment_method_type": "card | pix",
  "captured_at": "datetime",
  "metadata": {}
}
```

#### Regras de `Payment`

- `Payment.order_id` é obrigatório após criação do `Order` e deve apontar para exatamente um pedido.
- `Payment.amount` e `Payment.captured_amount` devem ser inteiros expressos na menor unidade monetária da moeda.
- `Payment.amount` deve ser maior ou igual a `0`.
- `Payment.captured_amount` deve ser maior ou igual a `0`.
- `Payment.captured_amount` não pode exceder `Payment.amount`.
- `Payment.currency_code` deve ser `BRL` no MVP.
- `Payment.captured_amount` é a base para cálculo de reembolsos e para validação contra reembolso acima do valor capturado.
- `Payment.status` representa o estado financeiro denormalizado do pagamento. Ele deve ser recalculado a partir de `Payment.captured_amount` e dos `Refund.status = succeeded` associados, e não pode alterar automaticamente `Order.order_status`.
- `Payment.stripe_payment_intent_id` é obrigatório para pagamentos Stripe e deve permitir correlação inequívoca com `PaymentAttempt` e webhooks Stripe.
- `Payment.stripe_event_id` deve registrar o evento Stripe canônico que confirmou a captura do pagamento.
- `Payment.captured_at` deve ser preenchido quando o pagamento for considerado capturado.

#### Constraints monetárias de `Payment`

As seguintes constraints devem ser tratadas como invariantes de domínio. Quando possível, devem ser implementadas também como constraints de banco; quando dependerem de agregação ou do provedor, devem ser garantidas por transação de aplicação/workflow:

- `Payment.amount` deve ser inteiro e maior ou igual a `0`.
- `Payment.captured_amount` deve ser inteiro e maior ou igual a `0`.
- `Payment.captured_amount <= Payment.amount`.
- `Payment.currency_code = BRL` no MVP.
- Pagamentos com moeda diferente de `BRL` devem ser rejeitados no MVP antes da criação/confirmação do `Order`.

#### Regras

- `payment_status = refunded` não deve alterar automaticamente `order_status` para `canceled`.
- `payment_status = partially_refunded` não deve alterar automaticamente `order_status`.
- `order_status = canceled` só deve ocorrer por transição operacional explícita, como cancelamento aprovado no Admin e permitido pela Gelato.
- `order_status = shipped` deve ser usado quando houver despacho/tracking; `completed` não deve ser usado nesse momento.
- `order_status = completed` só deve ocorrer após `delivered` ou fechamento operacional explícito pós-entrega.
- Estados financeiros pré-Order, como Pix pendente, pagamento falho, expirado ou cancelado, devem permanecer em `PaymentAttempt`/`PaymentSession`, pois `Order` ainda não existe.
- `Payment.status` e `Order.payment_status` não devem ser editados isoladamente por Admin, scripts ou rotinas manuais; qualquer alteração deve decorrer de recomputação financeira.
- Se o Medusa expuser campos nativos com nomenclatura diferente, a implementação deve mapear esses campos para a semântica lógica deste documento via módulo, workflow ou metadata controlada.

---

### 4.9 Refund

Entidade customizada responsável por registrar solicitações, confirmações e falhas de reembolso.

#### Finalidade

- Registrar reembolsos totais e parciais iniciados pelo Admin.
- Correlacionar reembolso local com Stripe.
- Impedir que reembolso local seja assumido antes de confirmação confiável do provedor.
- Permitir auditoria de quem solicitou o reembolso, quando e por qual motivo.
- Separar ciclo financeiro de reembolso do ciclo operacional do pedido.

#### Campos mínimos

```json
{
  "id": "string",
  "order_id": "string",
  "payment_id": "string",
  "stripe_refund_id": "string | null",
  "amount": 0,
  "currency_code": "BRL",
  "status": "requested | processing | succeeded | failed | canceled",
  "requested_by_admin_id": "string | null",
  "requested_at": "datetime",
  "confirmed_at": "datetime | null",
  "failed_at": "datetime | null",
  "canceled_at": "datetime | null",
  "reason": "string | null",
  "failure_reason": "string | null",
  "metadata": {
    "stripe_event_id": "string | null",
    "idempotency_key": "string | null"
  },
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

#### Regras

- `Refund` deve pertencer a exatamente um `Order`.

- `Refund.amount` deve ser inteiro, positivo e expresso na menor unidade monetária da moeda.
- `Refund.amount` deve ser maior que `0`; reembolso zero ou negativo deve ser rejeitado.
- `Refund.currency_code` deve ser igual a `Payment.currency_code` do pagamento reembolsado.
- `Refund.currency_code` deve ser `BRL` no MVP.
- A soma de `Refund.amount` com status `succeeded`, `requested` ou `processing` não deve exceder `Payment.captured_amount` do respectivo pagamento.
- Só pode existir um `Refund` em `requested` ou `processing` por `Payment` por vez; novas solicitações devem aguardar conclusão, falha ou cancelamento da solicitação ativa.
- No MVP, o sistema não deve permitir override para reembolso acima do valor capturado.

#### Constraints monetárias de `Refund`

As seguintes constraints devem ser tratadas como invariantes de domínio:

- `Refund.amount` deve ser inteiro e maior que `0`.
- `Refund.currency_code` deve ser igual a `Payment.currency_code`.
- No MVP, `Refund.currency_code = BRL`.
- O saldo reembolsável disponível deve ser calculado como `Payment.captured_amount - soma(Refund.amount where status in succeeded, requested, processing)` antes de aceitar nova solicitação.
- A criação de `Refund.status = requested` e a transição para `processing` ou `succeeded` devem respeitar esse saldo de forma transacional para evitar corrida concorrente.

- `Refund` deve estar associado a um `Payment` sempre que o pagamento local já existir.
- O Admin pode criar uma solicitação com `status = requested`, mas isso não significa reembolso confirmado.
- O estado `succeeded` só deve ser aplicado após confirmação confiável do Stripe por webhook canônico.
- `Refund.status = succeeded` é a fonte de verdade para valores reembolsados confirmados; `Payment.status` e `Order.payment_status` devem ser derivados desse conjunto de refunds confirmados.
- `stripe_refund_id` deve ser persistido quando o Stripe retornar identificador do reembolso.
- `stripe_refund_id` deve ser único quando não nulo.
- Reembolso total deve marcar `Refund.status = succeeded` somente após confirmação do Stripe e, na mesma transação lógica, recalcular `Payment.status` / `Order.payment_status` para `refunded`.
- Reembolso parcial deve marcar `Refund.status = succeeded` somente após confirmação do Stripe e, na mesma transação lógica, recalcular `Payment.status` / `Order.payment_status` para `partially_refunded`.
- Reembolso total ou parcial não deve alterar automaticamente `Order.order_status` para `canceled`.
- Falha de reembolso deve preservar `error`/`failure_reason` e não alterar estado financeiro como se o reembolso tivesse ocorrido.
- Todo webhook Stripe relacionado a reembolso deve ser correlacionado a `WebhookEventLog` e, quando possível, ao `Refund` correspondente.

---

### 4.10 Fulfillment — falhas, retries e atenção operacional

Extensão operacional da entidade `Fulfillment` para suportar integração Gelato com retry, diagnóstico, idempotência e reprocessamento manual controlado.

#### Finalidade

- Registrar o ciclo de vida do fulfillment Gelato.
- Impedir duplicidade de pedido ativo na Gelato para o mesmo `Order`.
- Suportar retry com backoff para falhas temporárias.
- Preservar contexto de erro em falhas persistentes.
- Permitir que pedidos pagos com problema operacional sejam marcados como `requires_attention`.
- Permitir reprocessamento manual pelo Admin sem perder histórico.
- Correlacionar webhooks Gelato com o fulfillment correto.

#### Campos mínimos

```json
{
  "order_id": "string",
  "status": "pending | submitted_to_gelato | created | in_production | packed | shipped | delivered | failed | canceled",
  "gelato_order_id": "string | null",
  "gelato_status": "string | null",
  "gelato_last_event_id": "string | null",
  "tracking_number": "string | null",
  "tracking_url": "string | null",
  "idempotency_key": "medusa_order_id",
  "retry_count": 0,
  "max_retry_count": 0,
  "last_error_code": "string | null",
  "last_error_message": "string | null",
  "requires_attention_reason": "string | null",
  "submitted_at": "datetime | null",
  "created_at_gelato": "datetime | null",
  "failed_at": "datetime | null",
  "canceled_at": "datetime | null",
  "shipped_at": "datetime | null",
  "delivered_at": "datetime | null",
  "last_retry_at": "datetime | null",
  "next_retry_at": "datetime | null",
  "reprocessed_at": "datetime | null",
  "reprocessed_by_admin_id": "string | null",
  "metadata": {
    "correlation_id": "string | null",
    "gelato_payload_hash": "string | null"
  }
}
```


> Decisão de persistência: no MVP, `Fulfillment` só deve ser criado quando o workflow de fulfillment for enfileirado. Antes disso, `not_started` é estado derivado de `Order` confirmado sem `Fulfillment` associado; não é valor persistido em `Fulfillment.status`.

#### Semântica de status

| Estado | Significado |
|---|---|
| `pending` | Fulfillment enfileirado ou aguardando submissão. |
| `submitted_to_gelato` | Requisição enviada à Gelato; aguardando confirmação ou resposta final. |
| `created` | Pedido criado na Gelato e `gelato_order_id` persistido. |
| `in_production` | Produção iniciada. |
| `packed` | Produto embalado/pronto para envio, quando o provedor informar esse estágio. |
| `shipped` | Pedido despachado; tracking disponível ou envio confirmado. |
| `delivered` | Pedido entregue, se evento de entrega estiver disponível. |
| `failed` | Falha persistente ou irrecuperável no fulfillment. |
| `canceled` | Fulfillment cancelado no fluxo operacional permitido. |

#### Regras

- `Fulfillment.idempotency_key` deve ser baseado no `Order` Medusa, preferencialmente `medusa_order_id`/`order_id`.
- `Fulfillment` só deve ser criado quando o workflow de fulfillment for enfileirado. Antes disso, `not_started` é estado derivado do `Order` confirmado sem fulfillment associado.
- `Fulfillment.gelato_order_id` é o campo top-level canônico para lookup de webhooks Gelato. `metadata` pode conter payload auxiliar, mas não deve ser fonte canônica para lookup.
- Webhooks Gelato devem localizar fulfillment preferencialmente por `Fulfillment.gelato_order_id`.
- Para o MVP, deve existir no máximo um fulfillment Gelato ativo por `Order`.
- `gelato_order_id` deve ser único entre fulfillments ativos quando não nulo.
- Falhas temporárias devem incrementar `retry_count`, registrar `last_error_code`, `last_error_message`, `last_retry_at` e, quando aplicável, `next_retry_at`.
- Ao esgotar retries ou encontrar erro irrecuperável, `Fulfillment.status` deve ir para `failed` e o `Order.order_status` deve ir para `requires_attention`.
- `requires_attention_reason` deve ser preenchido quando o fulfillment falhar de forma persistente, quando metadados Gelato forem inválidos ou quando houver inconsistência que bloqueie produção/envio.
- Reprocessamento manual deve preservar histórico, atualizar `reprocessed_at` e, quando houver admin autenticado, `reprocessed_by_admin_id`.
- Reprocessamento manual não deve criar segundo pedido ativo na Gelato se já existir `gelato_order_id` ativo para o mesmo `Order`.
- Webhooks Gelato duplicados, atrasados ou fora de ordem não devem regredir status interno sem regra explícita.
- Tracking recebido deve atualizar o fulfillment correto e pode mover `Order.order_status` para `shipped`, mas não para `completed`.
- Evento de entrega, se disponível, pode mover fulfillment para `delivered` e `Order.order_status` para `delivered`.
- `completed` continua reservado ao fechamento operacional do `Order`, não ao fulfillment em si.

---

### 4.11 LineItem — Snapshot Gelato

O `LineItem` deve preservar os dados Gelato necessários para produzir exatamente o item vendido no momento do pedido.

#### Finalidade

- Congelar o mapeamento Gelato usado pelo pedido confirmado.
- Impedir que alterações futuras em `ProductVariant.metadata` mudem pedidos antigos.
- Permitir que o payload Gelato seja reconstruído de forma auditável.
- Facilitar diagnóstico quando uma variante for alterada, despublicada ou remapeada após a compra.

#### Campos recomendados em `LineItem.metadata.gelato_snapshot`

| Campo | Tipo lógico | Obrigatório | Observação |
|---|---|---:|---|
| `gelato_product_uid` | string | Sim | Identificador do produto Gelato usado para produção. |
| `gelato_template_id` | string | Sim | Template fixo Gelato aplicado ao item. |
| `gelato_variant_options` | object | Sim | Opções produtivas como tamanho e cor. |
| `template_mode` | string | Sim | Para o MVP, valor esperado: `fixed`. |
| `source_product_variant_id` | string | Sim | ID da variante Medusa de origem. |
| `source_product_variant_sku` | string | Sim | SKU da variante no momento do pedido. |
| `captured_at` | datetime | Sim | Momento em que o snapshot foi capturado. |

#### Regras

- O snapshot deve ser criado antes do início do fulfillment Gelato, preferencialmente durante a criação do `Order`.
- O snapshot deve ser derivado dos metadados obrigatórios da `ProductVariant` no momento do pedido.
- O fulfillment de pedidos existentes deve usar `LineItem.metadata.gelato_snapshot`, não `ProductVariant.metadata` atual.
- Se o snapshot estiver ausente ou inválido, o fulfillment deve ser bloqueado e o pedido deve ir para `requires_attention` quando aplicável.
- Alterações administrativas em produto, variante, SKU ou metadados Gelato só devem afetar novas compras.

### 4.12 ExchangeRequest — Trocas e Logística Reversa

Entidade customizada responsável por registrar o ciclo operacional de solicitação, análise, aprovação, postagem, recebimento e conclusão/cancelamento de trocas.

#### Finalidade

- Associar cada troca a um `Order` existente.
- Registrar o número sequencial da troca dentro do pedido.
- Aplicar a regra de frete da primeira troca e de trocas adicionais.
- Preservar o canal de solicitação usado pelo cliente.
- Registrar dados operacionais de logística reversa dos Correios.
- Permitir auditoria de decisões administrativas como aprovação, recusa, cancelamento, recebimento e conclusão.
- Suportar fluxo manual/semiautomático no MVP sem exigir integração automatizada com API dos Correios.

#### Campos mínimos

```json
{
  "id": "string",
  "order_id": "string",
  "exchange_number_for_order": 1,
  "status": "requested | approved | awaiting_posting | posted | received | completed | rejected | canceled",
  "reason": "string | null",
  "requested_channel": "support_email | contact_form | admin_manual",
  "requested_by_email": "string | null",
  "shipping_cost_owner": "company | customer",
  "provider": "correios | null",
  "reverse_logistics_code": "string | null",
  "correios_deadline": "datetime | null",
  "instructions": "string | null",
  "instructions_sent_at": "datetime | null",
  "requested_at": "datetime",
  "approved_at": "datetime | null",
  "rejected_at": "datetime | null",
  "canceled_at": "datetime | null",
  "posted_at": "datetime | null",
  "received_at": "datetime | null",
  "completed_at": "datetime | null",
  "metadata": {
    "admin_notes": "string | null",
    "correlation_id": "string | null"
  },
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

#### Semântica de status

| Estado | Significado |
|---|---|
| `requested` | Registro criado e aguardando análise administrativa. |
| `approved` | Troca aprovada pelo Admin. |
| `awaiting_posting` | Instruções de postagem/logística reversa foram registradas e enviadas; cliente deve postar o produto. |
| `posted` | Cliente postou o produto nos Correios ou canal definido. |
| `received` | Produto retornado foi recebido pela operação. |
| `completed` | Troca encerrada operacionalmente. |
| `rejected` | Solicitação recusada após análise administrativa. |
| `canceled` | Solicitação cancelada antes de conclusão, por decisão administrativa ou solicitação do cliente conforme política. |

#### Regras

- `ExchangeRequest` deve pertencer a exatamente um `Order` existente.
- O registro formal da troca deve ser criado ou validado pelo Admin; solicitação por e-mail de suporte não cria automaticamente troca no banco.
- `exchange_number_for_order` deve ser sequencial dentro do pedido e único em combinação com `order_id`.
- Para `exchange_number_for_order = 1`, o valor esperado de `shipping_cost_owner` é `company`, salvo override administrativo explícito registrado em `AdminActionLog`.
- Para `exchange_number_for_order > 1`, o valor esperado de `shipping_cost_owner` é `customer`, salvo override administrativo explícito registrado em `AdminActionLog`.
- O status `canceled` deve ser permitido e deve preencher `canceled_at`.
- O status `rejected` deve preencher `rejected_at`.
- O status `approved` deve preencher `approved_at`.
- O status `posted` deve preencher `posted_at`.
- O status `received` deve preencher `received_at`.
- O status `completed` deve preencher `completed_at`.
- O status `awaiting_posting` só deve ser usado quando `instructions` não for nulo e houver `EmailDeliveryLog.status = sent` para `email_type = exchange_instructions`, ou quando `instructions_sent_at` estiver preenchido por fluxo operacional equivalente e auditável.
- `provider` pode ser `null` nos estados `requested`, `approved`, `rejected` e `canceled` enquanto não houver logística reversa registrada.
- `provider = correios` é obrigatório quando a troca estiver em `awaiting_posting`, `posted`, `received` ou quando houver logística reversa registrada.
- Overrides de custo de frete devem ter `reason` obrigatório e registro correlacionado em `AdminActionLog`.
- Quando houver logística reversa Correios registrada, `provider` deve ser `correios` e `reverse_logistics_code`, `correios_deadline` e `instructions` devem ser preenchidos quando disponíveis.
- `instructions_sent_at` deve ser preenchido apenas depois do envio efetivo das instruções ao cliente.
- A troca não deve alterar automaticamente `Order.order_status`, `Order.payment_status` ou criar reembolso sem fluxo administrativo explícito.
- Reenvio, reembolso ou outras ações finais da troca permanecem decisões operacionais fora do fechamento automático do MVP, salvo regra posterior documentada.

---

### 4.13 EmailDeliveryLog — E-mails Transacionais e Alertas

Entidade customizada responsável por registrar o ciclo de envio, falha, retry e auditoria de e-mails transacionais e alertas operacionais.

#### Finalidade

- Registrar e-mails enviados pelo Resend ou provedor equivalente.
- Garantir idempotência de e-mails por entidade e tipo.
- Permitir reprocessamento de falhas sem duplicar mensagens já enviadas.
- Correlacionar mensagens com `Order`, `Refund`, `ExchangeRequest`, `Customer`, `TrackingAccessToken` e `OperationalAlert` quando aplicável.
- Auditar falhas de envio sem cancelar pedido pago, reembolso confirmado ou fluxo de troca já aprovado.
- Evitar armazenamento de token de tracking puro, secrets, dados completos de pagamento ou corpo integral com dados sensíveis.

#### Campos mínimos

```json
{
  "id": "string",
  "entity_type": "order | customer | exchange_request | refund | operational_alert | auth | tracking | unknown",
  "entity_id": "string | null",
  "email_type": "order_confirmation | shipment_tracking | cancellation | refund | welcome | password_reset | exchange_instructions | operational_alert",
  "recipient": "string",
  "provider": "resend",
  "template_key": "string",
  "template_version": "string | null",
  "subject": "string | null",
  "resend_message_id": "string | null",
  "status": "pending | sent | failed | retrying | canceled | suppressed",
  "idempotency_key": "string",
  "retry_count": 0,
  "max_retry_count": 0,
  "last_error_code": "string | null",
  "last_error_message": "string | null",
  "metadata": {
    "order_id": "string | null",
    "order_public_ref": "string | null",
    "tracking_token_id": "string | null",
    "refund_id": "string | null",
    "exchange_request_id": "string | null",
    "operational_alert_id": "string | null",
    "correlation_id": "string | null"
  },
  "created_at": "datetime",
  "updated_at": "datetime",
  "sent_at": "datetime | null",
  "failed_at": "datetime | null",
  "next_retry_at": "datetime | null",
  "canceled_at": "datetime | null"
}
```

#### Semântica de `email_type`

| Tipo | Entidade principal | Quando usar |
|---|---|---|
| `order_confirmation` | `Order` | Após `Order` confirmado e antes da tentativa de fulfillment Gelato. |
| `shipment_tracking` | `Order` / `Fulfillment` | Quando tracking estiver disponível ou pedido for enviado. |
| `cancellation` | `Order` | Quando cancelamento operacional for confirmado. |
| `refund` | `Refund` | Somente após `Refund.status = succeeded` confirmado via Stripe. |
| `welcome` | `Customer` | Após criação de conta, quando habilitado. |
| `password_reset` | `Customer` / Auth | Para redefinição de senha com validade limitada. |
| `exchange_instructions` | `ExchangeRequest` | Após aprovação de troca e registro de instruções suficientes. |
| `operational_alert` | `OperationalAlert` | Para alertas críticos ao Admin. |

#### Semântica de `status`

| Estado | Significado |
|---|---|
| `pending` | Registro criado, envio ainda não concluído. |
| `sent` | Provedor aceitou ou confirmou envio. |
| `failed` | Envio falhou sem nova tentativa agendada. |
| `retrying` | Falha recuperável com nova tentativa agendada. |
| `canceled` | Envio cancelado antes de sair. |
| `suppressed` | Envio suprimido por idempotência, regra operacional ou deduplicação. |

#### Regras

- Todo e-mail transacional Must Have deve gerar `EmailDeliveryLog` antes ou durante a tentativa de envio.
- `idempotency_key` deve impedir duplicidade de mensagens para a mesma entidade e tipo.
- Para `order_confirmation`, a chave recomendada é `order_id + email_type`.
- Para `shipment_tracking`, a chave recomendada é `order_id + email_type + tracking_number` ou `fulfillment_id + email_type` quando tracking puder mudar.
- Para `refund`, a chave recomendada é `refund_id + email_type`.
- Para `exchange_instructions`, a chave recomendada é `exchange_request_id + email_type`.
- Para `operational_alert`, a chave recomendada é `alert_type + entity_id + date_bucket` ou `operational_alert_id + email_type`, conforme a estratégia de deduplicação.
- E-mail de confirmação de pedido deve ser criado após `Order` confirmado e não deve depender do sucesso da criação Gelato.
- E-mail de reembolso só pode ser enviado após `Refund.status = succeeded`.
- E-mail de instruções de troca só pode ser enviado quando a `ExchangeRequest` estiver aprovada ou em `awaiting_posting` e possuir instruções suficientes para o cliente agir.
- Falha no envio de e-mail deve registrar `last_error_code`, `last_error_message`, `retry_count` e, quando aplicável, `next_retry_at`.
- Falha no envio de e-mail não deve cancelar pedido pago, desfazer reembolso confirmado nem alterar automaticamente status de troca.
- `resend_message_id` deve ser persistido quando o provedor retornar identificador de mensagem.
- `recipient` é dado pessoal e deve ser tratado conforme LGPD; evitar replicar corpo integral da mensagem em logs.
- `EmailDeliveryLog` não deve armazenar token de tracking em texto puro. Quando necessário, referenciar `TrackingAccessToken.id` em `metadata.tracking_token_id`.


### 4.14 AdminActionLog — Auditoria Administrativa

Entidade customizada responsável por registrar ações administrativas críticas executadas no Admin.

#### Finalidade

- Auditar ações humanas ou administrativas que alterem estado operacional, financeiro ou produtivo.
- Registrar quem executou a ação, quando, sobre qual entidade e com qual resultado.
- Correlacionar ações administrativas com pedidos, fulfillments, reembolsos, trocas, produtos, clientes, alertas e eventos técnicos.
- Preservar histórico para suporte, investigação de incidentes, revisão operacional e controle de overrides.
- Registrar tentativas bloqueadas ou falhas de ações críticas, não apenas ações bem-sucedidas.
- Evitar que alterações administrativas sensíveis ocorram sem rastreabilidade mínima.

#### Campos mínimos

```json
{
  "id": "string",
  "admin_id": "string",
  "admin_email": "string | null",
  "action": "cancel_order | refund_order | reprocess_fulfillment | approve_exchange | reject_exchange | cancel_exchange | update_exchange | override_exchange_shipping_cost | mark_requires_attention | resolve_requires_attention | publish_product | unpublish_product | update_product | update_product_variant | update_gelato_metadata | resend_email | other",
  "entity_type": "order | fulfillment | refund | exchange_request | product | product_variant | customer | email_delivery_log | operational_alert | other",
  "entity_id": "string",
  "result": "requested | succeeded | failed | blocked",
  "severity": "info | warning | critical",
  "reason": "string | null",
  "previous_state": {},
  "new_state": {},
  "metadata": {
    "order_id": "string | null",
    "fulfillment_id": "string | null",
    "refund_id": "string | null",
    "exchange_request_id": "string | null",
    "product_id": "string | null",
    "product_variant_id": "string | null",
    "email_delivery_log_id": "string | null",
    "webhook_event_log_id": "string | null",
    "operational_alert_id": "string | null",
    "request_id": "string | null",
    "correlation_id": "string | null",
    "ip_hash": "string | null",
    "user_agent_hash": "string | null"
  },
  "created_at": "datetime"
}
```

#### Semântica de `action`

| Ação | Quando registrar | Entidade principal |
|---|---|---|
| `cancel_order` | Admin solicita ou confirma cancelamento operacional de pedido. | `Order` |
| `refund_order` | Admin solicita reembolso total ou parcial. | `Refund` / `Order` |
| `reprocess_fulfillment` | Admin reprocessa fulfillment Gelato falho ou pedido em atenção. | `Fulfillment` / `Order` |
| `approve_exchange` | Admin aprova solicitação de troca. | `ExchangeRequest` |
| `reject_exchange` | Admin recusa solicitação de troca. | `ExchangeRequest` |
| `cancel_exchange` | Admin cancela solicitação de troca sem concluí-la. | `ExchangeRequest` |
| `update_exchange` | Admin altera dados operacionais da troca. | `ExchangeRequest` |
| `override_exchange_shipping_cost` | Admin altera manualmente responsável pelo frete de troca. | `ExchangeRequest` |
| `mark_requires_attention` | Admin marca entidade como exigindo atenção operacional. | `Order` / `Fulfillment` |
| `resolve_requires_attention` | Admin resolve pendência operacional. | `Order` / `Fulfillment` |
| `publish_product` | Admin publica produto. | `Product` |
| `unpublish_product` | Admin despublica produto. | `Product` |
| `update_product` | Admin altera dados relevantes de produto. | `Product` |
| `update_product_variant` | Admin altera variante vendável. | `ProductVariant` |
| `update_gelato_metadata` | Admin altera metadados Gelato de variante/produto. | `ProductVariant` |
| `resend_email` | Admin reenvia ou solicita reprocessamento de e-mail. | `EmailDeliveryLog` |
| `other` | Ação administrativa relevante sem tipo específico. | Variável |

#### Semântica de `result`

| Resultado | Significado |
|---|---|
| `requested` | A ação foi solicitada e ainda depende de confirmação assíncrona, como reembolso Stripe. |
| `succeeded` | A ação administrativa foi concluída com sucesso no sistema. |
| `failed` | A ação tentou executar, mas falhou. |
| `blocked` | A ação foi impedida por regra de negócio, permissão, estado incompatível ou validação. |

#### Regras

- Ações administrativas críticas devem gerar `AdminActionLog` antes, durante ou imediatamente após a tentativa de execução.
- Ações bloqueadas por regra de negócio também devem ser registradas com `result = blocked` quando forem relevantes para auditoria.
- `AdminActionLog` é append-only: registros não devem ser editados ou removidos em fluxo normal de aplicação.
- `AdminActionLog` não é fonte de verdade para estado de negócio; ele apenas documenta ações e tentativas.
- Alterações de estado devem continuar persistidas nas entidades de domínio correspondentes.
- `refund_order` deve referenciar `Refund` quando a entidade for criada.
- `reprocess_fulfillment` deve referenciar `Fulfillment` e `Order`.
- `approve_exchange`, `reject_exchange`, `cancel_exchange`, `update_exchange` e `override_exchange_shipping_cost` devem referenciar `ExchangeRequest`.
- Alterações em metadados Gelato devem registrar snapshot mínimo em `previous_state` e `new_state`, sem incluir secrets.
- `reason` deve ser obrigatório para overrides, cancelamentos, reembolsos, recusas de troca e reprocessamentos manuais.
- `previous_state`, `new_state` e `metadata` não devem armazenar secrets, tokens de tracking puros, dados completos de cartão ou payloads extensos com dados sensíveis.

---


### 4.15 AnalyticsEventLog — Eventos Analíticos Externos

Entidade customizada responsável por registrar, auditar e tornar idempotente eventos analíticos externos críticos usando padrão de outbox local.

#### Finalidade

- Persistir localmente o evento de domínio `purchase_completed`.
- Separar o registro durável do evento da entrega externa ao PostHog.
- Impedir duplicidade de eventos analíticos de receita/conversão.
- Permitir retry controlado quando o provedor externo falhar.
- Registrar payload seguro sem expor `order_id` interno.
- Servir como pré-condição local para início do fulfillment Gelato quando o evento for `purchase_completed`, sem acoplar produção ao sucesso de entrega ao PostHog.

#### Campos mínimos

```json
{
  "id": "string",
  "event_name": "purchase_completed",
  "provider": "posthog",
  "entity_type": "order | cart | payment_attempt",
  "entity_id": "string",
  "order_id": "string | null",
  "order_analytics_id": "string | null",
  "order_public_ref": "string | null",
  "idempotency_key": "string",
  "payload_hash": "string",
  "provider_event_id": "string | null",
  "status": "recorded | queued | sent | failed | ignored",
  "retry_count": 0,
  "last_error_message": "string | null",
  "recorded_at": "datetime",
  "queued_at": "datetime | null",
  "sent_at": "datetime | null",
  "failed_at": "datetime | null",
  "metadata": {},
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

#### Semântica de `status`

| Estado | Significado |
|---|---|
| `recorded` | Evento de domínio registrado localmente de forma durável. Ainda não foi enfileirado ou enviado ao provedor externo. |
| `queued` | Evento registrado e enfileirado para entrega assíncrona ao provedor externo. |
| `sent` | Provedor externo aceitou ou confirmou a entrega do evento. |
| `failed` | Entrega externa falhou após o registro local; o evento continua sendo registro durável válido e deve ser elegível para retry quando recuperável. |
| `ignored` | Evento suprimido por duplicidade, regra operacional ou decisão explícita. Não satisfaz pré-condição de fulfillment. |

#### Regras

- No MVP, o único `event_name` obrigatório é `purchase_completed`. Outros eventos analíticos críticos podem ser adicionados posteriormente sem alterar a regra canônica de receita/conversão.
- `purchase_completed` deve gerar exatamente um `AnalyticsEventLog` canônico por `Order`, usando `AnalyticsEventLog.idempotency_key = purchase_completed:{order_id}`.
- O registro local durável de `purchase_completed` ocorre quando existe `AnalyticsEventLog` com `event_name = purchase_completed`, `order_id` do pedido, `recorded_at` preenchido e `status` diferente de `ignored`.
- O fulfillment Gelato pode iniciar depois de existir o registro local durável de `purchase_completed` para o respectivo `Order`. Não é necessário aguardar `status = sent`.
- Falha temporária de entrega ao PostHog deve alterar o estado de entrega/retry do `AnalyticsEventLog`, mas não deve bloquear produção de pedido pago.
- A entrega ao PostHog deve ser assíncrona, reprocessável e idempotente.
- O payload enviado ao provedor externo não pode conter `order_id` interno como identificador externo.
- `order_analytics_id` ou `order_public_ref` seguro devem ser usados em payloads externos.
- Falha de envio deve preservar erro sanitizado e permitir retry sem duplicar evento.

---

### 4.16 OperationalAlert — Alertas Operacionais Persistidos

Entidade customizada responsável por registrar alertas críticos e acompanhar seu ciclo operacional.

#### Finalidade

- Persistir falhas críticas e alertas operacionais.
- Correlacionar alertas com pedidos, fulfillments, pagamentos, trocas ou eventos sistêmicos.
- Permitir envio de alerta por e-mail via `EmailDeliveryLog`.
- Permitir reconhecimento, resolução ou descarte operacional do alerta.

#### Campos mínimos

```json
{
  "id": "string",
  "severity": "low | medium | high | critical",
  "type": "string",
  "entity_type": "order | fulfillment | payment | payment_attempt | exchange_request | system | null",
  "entity_id": "string | null",
  "message": "string",
  "status": "open | acknowledged | resolved | ignored",
  "sent_at": "datetime | null",
  "acknowledged_at": "datetime | null",
  "resolved_at": "datetime | null",
  "metadata": {},
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

#### Regras

- Falhas críticas persistentes devem criar `OperationalAlert`.
- `OperationalAlert.entity_type` deve usar os valores canônicos da seção 2.17; para trocas, usar `exchange_request`, nunca `exchange`.
- `EmailDeliveryLog` de alerta operacional deve referenciar `OperationalAlert.id`.
- `OperationalAlert` não substitui logs técnicos, `WebhookEventLog`, `Fulfillment` ou `EmailDeliveryLog`.
- Alertas não devem armazenar secrets, tokens puros, dados completos de cartão ou payloads extensos sensíveis.

---

## 5. Metadados Obrigatórios e Espelhos Complementares

A Seção 4 é a fonte canônica dos campos mínimos das entidades customizadas, extensões controladas e identificadores complementares. Esta Seção 5 lista metadados JSON obrigatórios e espelhos complementares usados para validação, documentação operacional e implementação. Quando uma entidade aparecer na Seção 4 e na Seção 5, a Seção 4 prevalece para campos mínimos e semântica; a Seção 5 não deve ser usada isoladamente como DDL.

### 5.1 ProductVariant

```json
{
  "gelato_product_uid": "string",
  "gelato_template_id": "string",
  "gelato_variant_options": {
    "size": "string",
    "color": "string"
  }
}
```

Como a estratégia definida usa templates fixos na Gelato, o campo `print_file_url` não é obrigatório para o MVP, salvo se a implementação específica do template exigir referência externa.

### 5.2 LineItem

```json
{
  "gelato_snapshot": {
    "gelato_product_uid": "string",
    "gelato_template_id": "string",
    "gelato_variant_options": {
      "size": "string",
      "color": "string"
    },
    "template_mode": "fixed",
    "source_product_variant_id": "string",
    "source_product_variant_sku": "string",
    "captured_at": "datetime"
  }
}
```

O snapshot Gelato do `LineItem` é obrigatório para itens de `Order` que serão enviados à Gelato. Ele pode ser preenchido no item do carrinho durante o checkout, mas deve estar consolidado no `LineItem` do `Order` antes do fulfillment.

### 5.3 ProductImage

```json
{
  "storage_provider": "supabase",
  "bucket": "product-images",
  "path": "products/{product_id}/{filename}",
  "public_url": "string"
}
```

### 5.4 PaymentCollection

```json
{
  "cart_id": "string",
  "checkout_reference": "string",
  "amount": 0,
  "currency_code": "BRL"
}
```

### 5.5 PaymentSession

```json
{
  "provider_id": "stripe",
  "stripe_payment_intent_id": "string",
  "payment_method_type": "card | pix"
}
```

### 5.6 PaymentAttempt

```json
{
  "cart_id": "string",
  "payment_collection_id": "string",
  "payment_session_id": "string",
  "stripe_payment_intent_id": "string",
  "payment_method_type": "card | pix",
  "status": "pending | awaiting_pix_payment | processing | captured | failed | expired | canceled"
}
```

### 5.7 CheckoutCompletionLog

```json
{
  "operation": "complete_checkout_create_order",
  "idempotency_key": "payment_intent_id | cart_id + payment_intent_id",
  "cart_id": "string",
  "payment_intent_id": "string",
  "payment_attempt_id": "string | null",
  "order_id": "string | null",
  "status": "processing | completed | failed"
}
```

### 5.8 WebhookEventLog

```json
{
  "provider": "stripe | gelato",
  "external_event_id": "string | null",
  "event_type": "string",
  "entity_type": "cart | payment_attempt | checkout_completion | order | payment | fulfillment | refund | exchange_request | unknown",
  "entity_id": "string | null",
  "payload_hash": "string",
  "deduplication_key": "string",
  "status": "received | processing | processed | ignored | failed",
  "processing_attempts": 0,
  "metadata": {
    "stripe_payment_intent_id": "string | null",
    "gelato_order_id": "string | null",
    "idempotency_key": "string | null",
    "correlation_id": "string | null"
  }
}
```

### 5.9 TrackingAccessToken

```json
{
  "order_id": "string",
  "token_hash": "string",
  "purpose": "guest_tracking",
  "expires_at": "datetime",
  "last_used_at": "datetime | null",
  "revoked_at": "datetime | null"
}
```

### 5.10 Order

```json
{
  "order_status": "confirmed | in_fulfillment | shipped | delivered | completed | canceled | requires_attention",
  "payment_status": "captured | refunded | partially_refunded",
  "order_analytics_id": "string",
  "order_public_ref": "string"
}
```

### 5.11 Fulfillment

```json
{
  "order_id": "string",
  "status": "pending | submitted_to_gelato | created | in_production | packed | shipped | delivered | failed | canceled",
  "gelato_order_id": "string | null",
  "gelato_status": "string | null",
  "gelato_last_event_id": "string | null",
  "tracking_number": "string | null",
  "tracking_url": "string | null",
  "idempotency_key": "medusa_order_id",
  "retry_count": 0,
  "max_retry_count": 0,
  "last_error_code": "string | null",
  "last_error_message": "string | null",
  "requires_attention_reason": "string | null",
  "submitted_at": "datetime | null",
  "failed_at": "datetime | null",
  "last_retry_at": "datetime | null",
  "next_retry_at": "datetime | null",
  "reprocessed_at": "datetime | null",
  "reprocessed_by_admin_id": "string | null"
}
```

`Fulfillment` deve suportar diagnóstico e reprocessamento operacional. Falha persistente deve preservar erro e permitir que o `Order` seja marcado como `requires_attention`, sem duplicar pedido Gelato ativo.

### 5.12 Payment

```json
{
  "order_id": "string",
  "provider_id": "stripe",
  "status": "captured | refunded | partially_refunded",
  "amount": 0,
  "captured_amount": 0,
  "currency_code": "BRL",
  "stripe_payment_intent_id": "string",
  "stripe_charge_id": "string | null",
  "stripe_event_id": "string",
  "payment_method_type": "card | pix",
  "captured_at": "datetime"
}
```

Este bloco é o espelho complementar dos campos financeiros mínimos definidos na Seção 4.8. `Payment.status` representa o estado financeiro denormalizado do pagamento. Ele deve ser recalculado a partir de `Payment.captured_amount` e `Refund.status = succeeded`, pode alimentar `Order.payment_status`, mas não deve alterar automaticamente `Order.order_status`. `Payment.captured_amount` é a base canônica para cálculo de reembolso e validação contra reembolso acima do capturado.

Constraints complementares: `amount` e `captured_amount` devem ser inteiros não negativos na menor unidade monetária; `captured_amount` não pode exceder `amount`; no MVP, `currency_code` deve ser `BRL`.

### 5.13 Refund

```json
{
  "order_id": "string",
  "payment_id": "string",
  "stripe_refund_id": "string | null",
  "amount": 0,
  "currency_code": "BRL",
  "status": "requested | processing | succeeded | failed | canceled",
  "requested_by_admin_id": "string | null",
  "requested_at": "datetime",
  "confirmed_at": "datetime | null",
  "reason": "string | null",
  "failure_reason": "string | null"
}
```

`Refund.status = succeeded` só deve ocorrer após confirmação confiável por webhook Stripe. O registro de reembolso não deve alterar automaticamente `Order.order_status`.

Constraints complementares: `amount` deve ser inteiro positivo na menor unidade monetária; `currency_code` deve ser igual ao `Payment.currency_code`; no MVP, `currency_code` deve ser `BRL`; o valor solicitado deve respeitar o saldo capturado disponível depois de considerar reembolsos confirmados e bloqueados.

### 5.14 ShippingOption

```json
{
  "gelato_shipment_method_uid": "string",
  "carrier": "string",
  "estimated_days_min": 0,
  "estimated_days_max": 0
}
```

### 5.15 ExchangeRequest

```json
{
  "order_id": "string",
  "exchange_number_for_order": 1,
  "status": "requested | approved | awaiting_posting | posted | received | completed | rejected | canceled",
  "reason": "string | null",
  "requested_channel": "support_email | contact_form | admin_manual",
  "requested_by_email": "string | null",
  "shipping_cost_owner": "company | customer",
  "provider": "correios | null",
  "reverse_logistics_code": "string | null",
  "correios_deadline": "datetime | null",
  "instructions": "string | null",
  "instructions_sent_at": "datetime | null",
  "requested_at": "datetime",
  "approved_at": "datetime | null",
  "rejected_at": "datetime | null",
  "canceled_at": "datetime | null",
  "posted_at": "datetime | null",
  "received_at": "datetime | null",
  "completed_at": "datetime | null"
}
```

`ExchangeRequest.status` deve incluir `canceled`. A troca deve manter histórico suficiente para auditoria operacional, mas não deve acionar reembolso, reenvio ou alteração financeira automaticamente sem fluxo administrativo explícito.


### 5.16 EmailDeliveryLog

```json
{
  "entity_type": "order | customer | exchange_request | refund | operational_alert | auth | tracking | unknown",
  "entity_id": "string | null",
  "email_type": "order_confirmation | shipment_tracking | cancellation | refund | welcome | password_reset | exchange_instructions | operational_alert",
  "recipient": "string",
  "provider": "resend",
  "template_key": "string",
  "status": "pending | sent | failed | retrying | canceled | suppressed",
  "idempotency_key": "string",
  "resend_message_id": "string | null",
  "retry_count": 0,
  "metadata": {
    "order_id": "string | null",
    "tracking_token_id": "string | null",
    "refund_id": "string | null",
    "exchange_request_id": "string | null",
    "operational_alert_id": "string | null"
  }
}
```

`EmailDeliveryLog` deve armazenar apenas dados necessários para auditoria, idempotência e reprocessamento. O corpo integral do e-mail, links com token puro, secrets e dados completos de pagamento não devem ser persistidos nessa entidade.


### 5.17 AdminActionLog

```json
{
  "admin_id": "string",
  "action": "cancel_order | refund_order | reprocess_fulfillment | approve_exchange | reject_exchange | cancel_exchange | update_exchange | override_exchange_shipping_cost | mark_requires_attention | resolve_requires_attention | publish_product | unpublish_product | update_product | update_product_variant | update_gelato_metadata | resend_email | other",
  "entity_type": "order | fulfillment | refund | exchange_request | product | product_variant | customer | email_delivery_log | operational_alert | other",
  "entity_id": "string",
  "result": "requested | succeeded | failed | blocked",
  "severity": "info | warning | critical",
  "reason": "string | null",
  "previous_state": {},
  "new_state": {},
  "metadata": {
    "order_id": "string | null",
    "fulfillment_id": "string | null",
    "refund_id": "string | null",
    "exchange_request_id": "string | null",
    "product_id": "string | null",
    "product_variant_id": "string | null",
    "email_delivery_log_id": "string | null",
    "webhook_event_log_id": "string | null",
    "operational_alert_id": "string | null",
    "correlation_id": "string | null"
  }
}
```

`AdminActionLog` deve registrar ações administrativas críticas com dados mínimos suficientes para auditoria. A entidade não deve armazenar secrets, tokens puros, dados completos de cartão ou payloads externos extensos.

---


### 5.18 AnalyticsEventLog

```json
{
  "event_name": "purchase_completed",
  "provider": "posthog",
  "entity_type": "order",
  "entity_id": "string",
  "order_id": "string",
  "order_analytics_id": "string",
  "idempotency_key": "purchase_completed:{order_id}",
  "payload_hash": "string",
  "status": "recorded | queued | sent | failed | ignored",
  "recorded_at": "datetime",
  "queued_at": "datetime | null",
  "sent_at": "datetime | null",
  "failed_at": "datetime | null"
}
```

`AnalyticsEventLog` deve ser a fonte persistida para comprovar o registro local durável de `purchase_completed`. No MVP, `purchase_completed` é o único `event_name` obrigatório. A entrega ao PostHog é assíncrona e reprocessável; `status = sent` comprova entrega externa, mas não é pré-condição para iniciar fulfillment Gelato.

### 5.19 OperationalAlert

```json
{
  "severity": "low | medium | high | critical",
  "type": "string",
  "entity_type": "order | fulfillment | payment | payment_attempt | exchange_request | system | null",
  "entity_id": "string | null",
  "message": "string",
  "status": "open | acknowledged | resolved | ignored"
}
```

`OperationalAlert` deve existir como entidade persistida para alertas críticos operacionais.

## 6. Relações e Cardinalidade

| Relação | Cardinalidade | Observação |
|---|---:|---|
| `Cart` → `LineItem` | 1:N | Um carrinho contém um ou mais itens. |
| `ProductVariant` → `LineItem` | 1:N lógico | O `LineItem` nasce de uma variante, mas deve preservar snapshot Gelato para que pedidos confirmados não dependam dos metadados atuais da variante. |
| `Order` → `LineItem` | 1:N | Um pedido confirmado contém itens com snapshot Gelato consolidado para fulfillment. |
| `Cart` → `PaymentCollection` | 1:1 ou 1:N | Recomenda-se uma coleção ativa por checkout; múltiplas podem existir por histórico, se necessário. |
| `PaymentCollection` → `PaymentSession` | 1:N | Permite recriar sessão ou trocar método de pagamento. |
| `Cart` → `PaymentAttempt` | 1:N | Um checkout pode ter múltiplas tentativas de pagamento. |
| `PaymentSession` → `PaymentAttempt` | 1:N | Uma sessão pode gerar uma ou mais tentativas conforme estratégia de implementação. |
| `PaymentAttempt` → `CheckoutCompletionLog` | 0:1 | Uma tentativa confirmada pode acionar uma operação idempotente de conclusão de checkout. |
| `CheckoutCompletionLog` → `Order` | 0:1 | Enquanto `processing` ou `failed`, `order_id` pode ser `null`; quando `completed`, deve apontar para o `Order` criado. |
| `PaymentAttempt` → `Order` | 0:1 | Antes do webhook aprovado, `order_id` deve ser `null`; após confirmação, aponta para o `Order`. |
| `PaymentAttempt` → `WebhookEventLog` | 1:N lógico | Uma tentativa pode receber múltiplos eventos Stripe ao longo do ciclo assíncrono. |
| `WebhookEventLog` → `PaymentAttempt` | N:1 ou 0:1 | Um log de webhook pode apontar para zero ou uma tentativa principal correlacionada por `stripe_payment_intent_id`. |
| `CheckoutCompletionLog` → `WebhookEventLog` | 1:N lógico | A conclusão de checkout pode ser causada ou auditada por um ou mais eventos Stripe. |
| `WebhookEventLog` → `CheckoutCompletionLog` | N:1 ou 0:1 | Um log de webhook pode apontar para zero ou uma operação principal de conclusão de checkout. |
| `Order` → `WebhookEventLog` | 1:N lógico | Um pedido pode ter múltiplos eventos externos correlacionados depois de criado. |
| `WebhookEventLog` → `Order` | N:1 ou 0:1 | Um log de webhook pode apontar para zero ou um pedido principal. |
| `Refund` → `WebhookEventLog` | 1:N lógico | Um reembolso pode ter múltiplos eventos Stripe associados. |
| `WebhookEventLog` → `Refund` | N:1 ou 0:1 | Um log de webhook pode apontar para zero ou um reembolso principal. |
| `WebhookEventLog` → `Fulfillment` | N:1 ou 0:1 | Um log de webhook pode apontar para zero ou um fulfillment principal por `gelato_order_id`. |
| `Fulfillment` → `WebhookEventLog` | 1:N lógico | Um fulfillment pode receber múltiplos eventos Gelato ao longo do ciclo de produção, envio e entrega. |
| `Order` → `TrackingAccessToken` | 1:N | Um pedido pode ter tokens de tracking para acesso anônimo por convidados, incluindo tokens rotacionados ou reemitidos. |
| `Order` → `AnalyticsEventLog` | 1:N lógico | Eventos como `purchase_completed` devem ser registrados com `order_analytics_id` ou `order_public_ref` seguro, nunca `order_id` interno no payload externo. |
| `AnalyticsEventLog` → `Order` | N:1 ou 0:1 | Um log de analytics pode apontar para zero ou um pedido principal, conforme `entity_type` e `entity_id`. |
| `TrackingAccessToken` → `Order` | N:1 | Cada token pertence a exatamente um pedido. |
| `Order` → `Payment` | 1:N | Um pedido pode ter um ou mais registros financeiros conforme a implementação Medusa/Stripe. `Payment.status` é denormalizado e deve ser recalculado a partir de `Payment.captured_amount` e `Refund.status = succeeded`; não deve alterar automaticamente `Order.order_status`. |
| `Order` → `Refund` | 1:N | Um pedido pode ter múltiplas solicitações de reembolso total/parcial ao longo do ciclo operacional. |
| `Payment` → `Refund` | 1:N | Um pagamento pode possuir um ou mais reembolsos, conforme suporte do provedor e regras operacionais. |
| `Order` → `Fulfillment` | 1:N | Para o MVP, espera-se um fulfillment principal Gelato por pedido. Eventos de fulfillment devem alterar `order_status` conforme o ciclo operacional, não o estado financeiro. |
| `Fulfillment` → `Order` | N:1 | Fulfillment pertence a um `Order` já confirmado; não pode existir para checkout pré-Order. |
| `Order` → `ExchangeRequest` | 1:N | Um pedido pode ter múltiplas solicitações de troca. |
| `ExchangeRequest` → `Order` | N:1 | Cada troca pertence a exatamente um pedido existente. |
| `ExchangeRequest` → Correios | N:1 lógico | No MVP, a correlação com Correios é operacional/manual por `reverse_logistics_code`, não integração automática via API. |
| `Order` → `EmailDeliveryLog` | 1:N | Um pedido pode gerar e-mails de confirmação, envio/rastreio, cancelamento e outros eventos transacionais. |
| `Refund` → `EmailDeliveryLog` | 1:N | Um reembolso confirmado pode gerar e-mail de reembolso ao cliente. |
| `ExchangeRequest` → `EmailDeliveryLog` | 1:N | Uma troca aprovada pode gerar e-mail de instruções de logística reversa. |
| `Customer` → `EmailDeliveryLog` | 1:N lógico | Conta de cliente pode gerar e-mails de boas-vindas e redefinição de senha. |
| `TrackingAccessToken` → `EmailDeliveryLog` | 1:N lógico | E-mails de confirmação e rastreio podem referenciar o token por ID, sem persistir token puro. |
| `OperationalAlert` → `EmailDeliveryLog` | 0:N | Alertas operacionais podem gerar e-mails para o Admin, com deduplicação por tipo/entidade/janela temporal. |
| `EmailDeliveryLog` → Resend | N:1 lógico | Cada registro de envio pode possuir um `resend_message_id` quando o provedor retornar identificador. |
| `AdminActionLog` → Admin/Auth User | N:1 lógico | Cada ação administrativa deve possuir `admin_id` do usuário autenticado que executou ou solicitou a ação. |
| `Order` → `AdminActionLog` | 1:N lógico | Um pedido pode ter múltiplas ações administrativas relacionadas. |
| `AdminActionLog` → `Order` | N:1 ou 0:1 | Um log administrativo pode apontar para zero ou um pedido principal. |
| `Fulfillment` → `AdminActionLog` | 1:N lógico | Um fulfillment pode ter múltiplas ações administrativas relacionadas. |
| `AdminActionLog` → `Fulfillment` | N:1 ou 0:1 | Um log administrativo pode apontar para zero ou um fulfillment principal. |
| `Refund` → `AdminActionLog` | 1:N lógico | Um reembolso pode ter múltiplas ações administrativas relacionadas. |
| `AdminActionLog` → `Refund` | N:1 ou 0:1 | Um log administrativo pode apontar para zero ou um reembolso principal. |
| `ExchangeRequest` → `AdminActionLog` | 1:N lógico | Uma troca pode ter múltiplas ações administrativas relacionadas. |
| `AdminActionLog` → `ExchangeRequest` | N:1 ou 0:1 | Um log administrativo pode apontar para zero ou uma troca principal. |
| `AdminActionLog` → `Product` / `ProductVariant` | 0:N lógico | Publicação, despublicação e alterações de metadados Gelato devem ser rastreáveis. |
| `AdminActionLog` → `EmailDeliveryLog` | 0:N | Reenvios ou reprocessamentos manuais de e-mail devem ser auditáveis. |
| `OperationalAlert` → `AdminActionLog` | 1:N lógico | Um alerta pode ter múltiplas ações administrativas de reconhecimento ou resolução. |
| `AdminActionLog` → `OperationalAlert` | N:1 ou 0:1 | Um log administrativo pode apontar para zero ou um alerta principal. |
| `Product` → `ProductVariant` | 1:N | Uma camiseta possui variantes de tamanho/cor. |
| `Product` → `ProductImage` | 1:N | Uma camiseta possui galeria de imagens. |

> Entidades de log são append-only e normalmente apontam para zero ou uma entidade principal via referência direta ou `entity_type + entity_id`, enquanto a entidade principal pode possuir múltiplos logs.

---

## 7. Regras de Integridade

| ID | Regra |
|---|---|
| `DATA-001` | Nenhuma variante pode ser publicada para venda sem `gelato_product_uid` e `gelato_template_id` ou equivalentes definidos. |
| `DATA-002` | Nenhum fulfillment Gelato pode ser criado sem endereço completo. |
| `DATA-003` | Nenhum fulfillment Gelato pode ser criado sem pagamento confirmado, `Order` confirmado e `purchase_completed` registrado de forma durável em `AnalyticsEventLog` para o respectivo `Order`. O fulfillment não deve depender de `status = sent` no PostHog. |
| `DATA-004` | Nenhum webhook pode atualizar pedido se não houver correspondência por identificador externo confiável. |
| `DATA-005` | Eventos externos e operações críticas devem ser idempotentes por chaves explícitas: `stripe_event_id` ou `WebhookEventLog.deduplication_key` para Stripe, `gelato_event_id` ou `WebhookEventLog.deduplication_key` derivada de payload normalizado para Gelato, `payment_intent_id` ou `cart_id + payment_intent_id` para conclusão de checkout/criação do `Order`, e `medusa_order_id`/`order_id` para criação de pedido Gelato. |
| `DATA-006` | Pedido Gelato não deve ser duplicado para o mesmo pedido Medusa; a criação de pedido Gelato deve possuir chave única por `medusa_order_id`/`order_id`. |
| `DATA-007` | Tracking deve ser associado ao fulfillment correto. |
| `DATA-008` | Logs não devem conter secrets, tokens ou dados completos de cartão. |
| `DATA-009` | Toda imagem de produto deve estar associada a um objeto no Supabase Storage ou URL válida. |
| `DATA-010` | Toda troca deve estar associada a um pedido existente. |
| `DATA-011` | A primeira troca de uma compra deve ter `shipping_cost_owner = company`, salvo override administrativo explícito registrado em `AdminActionLog`. |
| `DATA-012` | Trocas adicionais da mesma compra devem ter `shipping_cost_owner = customer`, salvo override administrativo explícito registrado em `AdminActionLog`. |
| `DATA-013` | `Order` Medusa não pode ser criado antes de webhook Stripe canônico aprovado. Antes disso, o estado comercial deve permanecer em `Cart`, `PaymentCollection`, `PaymentSession` e `PaymentAttempt`. |
| `DATA-014` | Criação de `Order` deve ser idempotente por `payment_intent_id` ou `cart_id + payment_intent_id`. |
| `DATA-015` | Pix pendente, expirado, cancelado ou falho não pode criar `Order` nem iniciar fulfillment. |
| `DATA-016` | `purchase_completed` deve ser emitido apenas uma vez por `Order` confirmado e deve possuir registro persistido em `AnalyticsEventLog`. |
| `DATA-017` | Eventos externos de analytics não podem receber `order_id` interno; devem usar `order_analytics_id`, `order_public_ref` seguro ou hash não reversível. |
| `DATA-018` | Tracking anônimo deve usar token seguro com hash persistido e expiração. |
| `DATA-019` | Reembolso confirmado altera estado financeiro agregado, mas não altera automaticamente `order_status` para `canceled`. |
| `DATA-020` | `completed` só pode ser usado após entrega confirmada ou fechamento operacional pós-entrega. |
| `DATA-021` | `PaymentAttempt.order_id` deve permanecer `null` até a criação efetiva do `Order`. |
| `DATA-022` | `PaymentAttempt` com status `awaiting_pix_payment`, `pending`, `failed`, `expired` ou `canceled` não pode iniciar fulfillment. |
| `DATA-023` | `PaymentAttempt.stripe_payment_intent_id` deve ser único quando não nulo e permitir correlação inequívoca com a tentativa de pagamento. |
| `DATA-024` | A operação de concluir checkout e criar `Order` deve ser registrada em `CheckoutCompletionLog` antes ou durante sua execução. |
| `DATA-025` | `CheckoutCompletionLog.idempotency_key` deve ser única e baseada em `payment_intent_id` ou `cart_id + payment_intent_id`. |
| `DATA-026` | Webhook Stripe reentregue para pagamento já processado deve reutilizar o `CheckoutCompletionLog` existente e não criar novo `Order`. |
| `DATA-027` | `CheckoutCompletionLog.status = completed` exige `order_id` preenchido. |
| `DATA-028` | `CheckoutCompletionLog.status = failed` não pode iniciar fulfillment nem emitir `purchase_completed` sem reprocessamento bem-sucedido. |
| `DATA-029` | Todo webhook Stripe ou Gelato relevante deve gerar um registro em `WebhookEventLog` antes ou durante o processamento. |
| `DATA-030` | Webhook com `provider + external_event_id` confiável já processado não pode gerar novo efeito colateral; a mesma regra deve ser aplicada por `provider + deduplication_key` para todos os webhooks relevantes. |
| `DATA-031` | Quando `external_event_id` não estiver disponível ou não for confiável, a deduplicação deve usar `WebhookEventLog.deduplication_key` derivada de `payload_hash` normalizado ou de chave determinística equivalente definida na integração. A constraint canônica deve ser `unique(provider, deduplication_key)`. |
| `DATA-032` | Webhook Stripe aprovado pode acionar `CheckoutCompletionLog`, mas a criação idempotente do `Order` deve continuar controlada por `CheckoutCompletionLog.idempotency_key`. |
| `DATA-033` | Webhook Gelato não pode atualizar fulfillment se não houver correlação confiável por `gelato_order_id`, ID externo equivalente ou payload validado. |
| `DATA-034` | `WebhookEventLog` não deve persistir secrets, tokens sensíveis, dados completos de cartão ou payload bruto excessivo. |
| `DATA-035` | Tracking anônimo de pedido convidado deve usar `TrackingAccessToken` validado server-side. |
| `DATA-036` | O token puro de tracking não pode ser persistido; apenas `token_hash` pode ser armazenado. |
| `DATA-037` | `TrackingAccessToken.token_hash` deve ser único e associado a exatamente um `Order`. |
| `DATA-038` | Token expirado, revogado, ausente ou inválido não pode expor dados nem existência do pedido; a resposta deve ser genérica. |
| `DATA-039` | Links de tracking enviados por e-mail devem usar token de acesso anônimo; consulta autenticada deve validar posse do pedido sem depender do token. |
| `DATA-040` | Todo `Order` confirmado deve possuir `order_analytics_id` antes da emissão de `purchase_completed`. |
| `DATA-041` | `order_analytics_id` deve ser único, não reversível e seguro para envio a ferramentas externas de analytics. |
| `DATA-042` | `order_public_ref` pode ser exibido ao cliente e ao suporte, mas não pode autorizar consulta anônima de pedido sem `TrackingAccessToken` ou autenticação. |
| `DATA-043` | Eventos externos de analytics não podem receber `order_id` interno do Medusa; devem usar `order_analytics_id`, `order_public_ref` seguro ou hash não reversível. |
| `DATA-044` | `AnalyticsEventLog` deve usar `idempotency_key` única, como `purchase_completed:{order_id}`, para implementar tecnicamente a regra de emissão única definida em `DATA-016`. |
| `DATA-045` | Todo `Order` deve manter `order_status` e `payment_status` como conceitos separados. |
| `DATA-046` | `payment_status = refunded` ou `payment_status = partially_refunded` deve ser derivado da agregação de reembolsos confirmados e não pode alterar automaticamente `order_status` para `canceled`. |
| `DATA-047` | `order_status = canceled` só pode ser aplicado por transição operacional explícita, como cancelamento aprovado pelo Admin e permitido pela Gelato. |
| `DATA-048` | `order_status = completed` não pode ser usado no momento do despacho; pedidos despachados devem usar `order_status = shipped`. |
| `DATA-049` | `order_status = completed` só pode ocorrer após `delivered` ou fechamento operacional explícito pós-entrega. |
| `DATA-050` | Todo reembolso iniciado pelo Admin deve gerar registro em `Refund` antes ou durante a chamada ao Stripe. |
| `DATA-051` | `Refund.status = succeeded` só pode ser aplicado após confirmação confiável do Stripe por webhook canônico. |
| `DATA-052` | `Refund.stripe_refund_id` deve ser único quando não nulo. |
| `DATA-053` | Reembolso falho não pode marcar `Refund.status = succeeded` nem recalcular `Payment.status` ou `Order.payment_status` como reembolsado. |
| `DATA-054` | Reembolso total ou parcial deve atualizar o estado financeiro agregado exclusivamente por recomputação baseada em `Refund.status = succeeded`; cancelamento continua sendo transição operacional explícita. |
| `DATA-055` | Webhooks Stripe relacionados a reembolso devem ser registrados em `WebhookEventLog` e correlacionados ao `Refund` correspondente quando possível. |
| `DATA-056` | Todo fulfillment Gelato deve pertencer a um `Order` confirmado; fulfillment não pode ser criado para `Cart`, `PaymentAttempt` ou checkout pré-Order. |
| `DATA-057` | Todo fulfillment Gelato deve possuir `idempotency_key` baseada no `Order`, preferencialmente `medusa_order_id`/`order_id`. |
| `DATA-058` | Deve existir no máximo um fulfillment Gelato ativo por `Order` no MVP, salvo fluxo explícito de cancelamento/substituição controlada. |
| `DATA-059` | `gelato_order_id` deve ser único entre fulfillments ativos quando não nulo. |
| `DATA-060` | Falhas temporárias de fulfillment devem incrementar `retry_count` e registrar último erro, última tentativa e próxima tentativa quando aplicável. |
| `DATA-061` | Fulfillment com falha persistente ou irrecuperável deve registrar `last_error_code`, `last_error_message` e `requires_attention_reason`. |
| `DATA-062` | Fulfillment em `failed` por falha persistente deve mover ou manter o `Order` em `requires_attention`, sem recriar o `Order` e sem perder o pagamento confirmado. |
| `DATA-063` | Reprocessamento manual de fulfillment deve preservar histórico e não pode criar segundo pedido Gelato ativo para o mesmo `Order`. |
| `DATA-064` | Webhook Gelato duplicado, atrasado ou fora de ordem não pode regredir status de fulfillment ou de pedido sem regra explícita de transição. |
| `DATA-065` | Tracking recebido da Gelato deve ser associado ao fulfillment correto e pode mover o pedido para `shipped`, mas não para `completed`. |
| `DATA-066` | Todo `LineItem` de `Order` enviado à Gelato deve possuir `metadata.gelato_snapshot` com `gelato_product_uid`, `gelato_template_id`, `gelato_variant_options`, `template_mode`, `source_product_variant_id`, `source_product_variant_sku` e `captured_at`. |
| `DATA-067` | O snapshot Gelato do `LineItem` deve ser derivado de `ProductVariant.metadata` no momento da criação/confirmação do `Order` ou antes do início do fulfillment. |
| `DATA-068` | Alterações futuras em `ProductVariant.metadata`, SKU, template ou opções Gelato não podem alterar `LineItem.metadata.gelato_snapshot` de pedidos já confirmados. |
| `DATA-069` | Payloads de criação Gelato para pedidos existentes devem usar o snapshot persistido no `LineItem`, não os metadados atuais da variante. |
| `DATA-070` | Se um `LineItem` confirmado não possuir snapshot Gelato válido, o fulfillment deve ser bloqueado e o `Order` deve ser marcado como `requires_attention` quando aplicável. |
| `DATA-071` | Toda `ExchangeRequest` deve estar associada a um `Order` existente. |
| `DATA-072` | `ExchangeRequest.exchange_number_for_order` deve ser único dentro de cada `order_id`. |
| `DATA-073` | Overrides de custo de frete em troca devem ser registrados em `AdminActionLog` com `reason` obrigatório. |
| `DATA-074` | Overrides de custo de frete não devem alterar automaticamente a política pública de troca; aplicam-se apenas à decisão operacional daquele caso. |
| `DATA-075` | `ExchangeRequest.status` deve aceitar `canceled` e preencher `canceled_at` quando esse estado for aplicado. |
| `DATA-076` | `ExchangeRequest.status = approved` deve preencher `approved_at`; `rejected` deve preencher `rejected_at`; `posted` deve preencher `posted_at`; `received` deve preencher `received_at`; `completed` deve preencher `completed_at`. |
| `DATA-077` | `ExchangeRequest.status = awaiting_posting` só pode ser aplicado quando `instructions` não for nulo e houver `EmailDeliveryLog.status = sent` para `email_type = exchange_instructions`, ou quando `instructions_sent_at` estiver preenchido por fluxo operacional equivalente e auditável. |
| `DATA-078` | `ExchangeRequest.provider` pode ser nulo até haver logística reversa registrada. Quando houver logística reversa Correios registrada, `provider = correios` e os campos `reverse_logistics_code`, `correios_deadline` e `instructions` devem ser preenchidos quando disponíveis. |
| `DATA-079` | `instructions_sent_at` só deve ser preenchido após envio efetivo das instruções ao cliente. |
| `DATA-080` | `ExchangeRequest` não deve alterar automaticamente `Order.order_status`, `Order.payment_status` ou criar `Refund` sem fluxo administrativo explícito. |
| `DATA-081` | Todo e-mail transacional obrigatório deve gerar `EmailDeliveryLog` antes ou durante a tentativa de envio. |
| `DATA-082` | `EmailDeliveryLog.idempotency_key` deve ser única para o escopo da mensagem e impedir duplicidade por entidade e tipo de e-mail. |
| `DATA-083` | E-mail de confirmação de pedido só pode ser enviado após `Order` confirmado e não deve depender do sucesso da criação do fulfillment Gelato. |
| `DATA-084` | E-mail de reembolso só pode ser enviado após `Refund.status = succeeded` confirmado por webhook Stripe confiável. |
| `DATA-085` | E-mail de instruções de troca só pode ser enviado quando `ExchangeRequest` possuir instruções suficientes e status compatível, como `approved` ou `awaiting_posting`. |
| `DATA-086` | Falha no envio de e-mail não pode cancelar pedido pago, desfazer reembolso confirmado, alterar `Order.order_status` nem alterar automaticamente `ExchangeRequest.status`. |
| `DATA-087` | `EmailDeliveryLog` não deve armazenar token de tracking puro, secrets, dados completos de cartão ou corpo integral com dados sensíveis. |
| `DATA-088` | `EmailDeliveryLog.resend_message_id` deve ser único quando não nulo. |
| `DATA-089` | E-mails falhos devem preservar erro, contador de retry e próxima tentativa quando reprocessáveis. |
| `DATA-090` | Alertas operacionais por e-mail devem ser deduplicados por regra explícita, como `alert_type + entity_id + date_bucket` ou `operational_alert_id + email_type`. |
| `DATA-091` | Ações administrativas críticas devem gerar `AdminActionLog` com `admin_id`, `action`, `entity_type`, `entity_id`, `result` e `created_at`. |
| `DATA-092` | `AdminActionLog` deve ser append-only; registros não devem ser alterados ou removidos em fluxo normal de aplicação. |
| `DATA-093` | Ações bloqueadas por regra de negócio, permissão ou estado incompatível devem ser registradas com `result = blocked` quando forem relevantes para auditoria. |
| `DATA-094` | `reason` deve ser obrigatório para cancelamento de pedido, solicitação de reembolso, reprocessamento manual de fulfillment, recusa de troca e overrides administrativos. |
| `DATA-095` | `AdminActionLog` não deve substituir as entidades de domínio; `Order`, `Refund`, `Fulfillment`, `ExchangeRequest` e demais entidades continuam sendo a fonte de verdade de estado. |
| `DATA-096` | Solicitações administrativas de reembolso devem gerar ou referenciar `Refund` e registrar `AdminActionLog.action = refund_order`. |
| `DATA-097` | Reprocessamento manual de fulfillment deve registrar `AdminActionLog.action = reprocess_fulfillment` e referenciar `Order` e `Fulfillment`. |
| `DATA-098` | Aprovação, recusa, cancelamento ou override de frete de troca devem gerar `AdminActionLog` correlacionado à `ExchangeRequest`. |
| `DATA-099` | Alterações em metadados Gelato de produto ou variante devem registrar snapshot mínimo em `previous_state` e `new_state`, sem alterar snapshots de pedidos já confirmados. |
| `DATA-100` | `AdminActionLog` não deve armazenar secrets, tokens de tracking puros, dados completos de cartão ou payloads extensos com dados sensíveis. |
| `DATA-101` | Reenvio ou reprocessamento manual de e-mails deve registrar `AdminActionLog` e referenciar `EmailDeliveryLog` quando aplicável. |
| `DATA-102` | `AnalyticsEventLog` deve registrar `purchase_completed` com idempotência por `purchase_completed:{order_id}`. |
| `DATA-103` | Fulfillment Gelato pode iniciar quando existir registro local durável de `AnalyticsEventLog` para `purchase_completed` do respectivo `Order`, com `recorded_at` preenchido e `status` diferente de `ignored`. `status = sent` não é obrigatório. |
| `DATA-104` | `OperationalAlert` deve existir como entidade persistida para alertas críticos operacionais. |
| `DATA-105` | `PaymentAttempt.stripe_payment_intent_id` deve ser único quando não nulo. |
| `DATA-106` | A soma de `Refund.amount` com status `succeeded`, `requested` ou `processing` não pode exceder `Payment.captured_amount` do respectivo pagamento. |
| `DATA-107` | `Order.payment_status` deve ser derivado de `Payment.captured_amount` menos a soma de `Refund.amount` com `status = succeeded`; se persistido, deve ser tratado como campo denormalizado recomputável. |
| `DATA-108` | `Fulfillment.gelato_order_id` deve ser campo top-level canônico para lookup de webhooks Gelato. |
| `DATA-109` | `ExchangeRequest.provider` pode ser nulo até haver logística reversa registrada. |
| `DATA-110` | Entidades de log devem ser append-only e apontar para entidades principais via referência direta ou `entity_type + entity_id`. |
| `DATA-111` | Só pode existir um `Refund` em `requested` ou `processing` por `Payment` por vez; novas solicitações de reembolso para o mesmo pagamento devem aguardar conclusão, falha ou cancelamento da solicitação ativa. |
| `DATA-112` | Campos `entity_type` devem usar os valores canônicos da seção 2.17; `exchange` e `alert` não devem ser usados em novos registros. |
| `DATA-113` | No MVP, `AnalyticsEventLog.event_name = purchase_completed` é o único evento analítico obrigatório; outros eventos podem ser adicionados posteriormente sem substituir a regra canônica de receita/conversão. |
| `DATA-114` | `Refund.status = succeeded` é a fonte de verdade para valores reembolsados confirmados. |
| `DATA-115` | `Payment.status` e `Order.payment_status` podem ser persistidos como campos denormalizados, mas devem ser recalculados na mesma transação lógica que confirma `Refund.status = succeeded`. |
| `DATA-116` | Nenhuma alteração manual isolada em `Payment.status` ou `Order.payment_status` deve ocorrer sem recomputação a partir de `Payment.captured_amount` e `Refund.status = succeeded`. |
| `DATA-117` | `Payment.amount` deve ser inteiro não negativo na menor unidade monetária. |
| `DATA-118` | `Payment.captured_amount` deve ser inteiro não negativo na menor unidade monetária. |
| `DATA-119` | `Payment.captured_amount` não pode exceder `Payment.amount`. |
| `DATA-120` | `Refund.amount` deve ser inteiro positivo na menor unidade monetária. |
| `DATA-121` | `Refund.currency_code` deve ser igual a `Payment.currency_code` do pagamento reembolsado. |
| `DATA-122` | No MVP, `Payment.currency_code` e `Refund.currency_code` devem ser `BRL`. |

---

## 8. Índices e Unicidade Recomendados

| Entidade | Índice / Constraint | Motivo |
|---|---|---|
| `PaymentCollection` | índice em `cart_id` | Buscar coleção ativa do checkout. |
| `PaymentSession` | índice em `payment_collection_id` | Buscar sessões por checkout. |
| `PaymentSession` | índice em `metadata.stripe_payment_intent_id` quando persistido em JSONB | Correlacionar com Stripe. |
| `PaymentAttempt` | unique parcial em `stripe_payment_intent_id` quando não nulo | Evitar duplicidade de tentativa para o mesmo PaymentIntent. |
| `PaymentAttempt` | índice composto em `cart_id, stripe_payment_intent_id` | Suportar idempotência e retorno assíncrono. |
| `PaymentAttempt` | índice em `status` | Consultar tentativas pendentes/expiradas. |
| `LineItem` | índice em `metadata.gelato_snapshot.source_product_variant_id` quando persistido em JSONB | Auditar quais pedidos usaram uma variante específica no momento da compra. |
| `LineItem` | índice em `metadata.gelato_snapshot.gelato_template_id` quando persistido em JSONB | Diagnosticar pedidos afetados por template Gelato específico. |
| `CheckoutCompletionLog` | unique em `idempotency_key` | Impedir execução duplicada da criação de `Order`. |
| `CheckoutCompletionLog` | índice em `payment_intent_id` | Localizar operação pelo evento Stripe. |
| `CheckoutCompletionLog` | índice composto em `cart_id, payment_intent_id` | Suportar correlação alternativa e diagnóstico operacional. |
| `CheckoutCompletionLog` | índice em `status, locked_at` | Recuperar operações presas em `processing` e reprocessar falhas controladas. |
| `CheckoutCompletionLog` | unique parcial em `order_id` quando não nulo | Evitar múltiplos logs concluídos apontando para o mesmo `Order` de forma indevida. |
| `WebhookEventLog` | unique em `provider, external_event_id` quando `external_event_id` não nulo | Deduplicar eventos externos com ID confiável. |
| `WebhookEventLog` | unique em `provider, deduplication_key` | Deduplicar de forma efetiva todo webhook relevante, incluindo fallback quando `external_event_id` não existir ou não for confiável. |
| `WebhookEventLog` | índice composto em `provider, payload_hash` | Diagnosticar eventos sem ID externo confiável e apoiar a construção de `deduplication_key`; não é a constraint canônica de deduplicação. |
| `WebhookEventLog` | índice em `event_type` | Consultar eventos por tipo. |
| `WebhookEventLog` | índice em `status, received_at` | Reprocessar falhas e auditar eventos pendentes. |
| `WebhookEventLog` | índice composto em `entity_type, entity_id` | Consultar eventos relacionados a uma entidade interna. |
| `WebhookEventLog` | índice em `metadata.stripe_payment_intent_id` quando persistido em JSONB | Correlacionar eventos Stripe com tentativa de pagamento. |
| `WebhookEventLog` | índice em `metadata.gelato_order_id` quando persistido em JSONB | Diagnosticar payloads Gelato recebidos antes/depois da correlação. Lookup canônico de fulfillment deve usar `Fulfillment.gelato_order_id`. |
| `TrackingAccessToken` | unique em `token_hash` | Validar token anônimo sem ambiguidade e impedir duplicidade. |
| `TrackingAccessToken` | índice em `order_id` | Localizar tokens ativos, expirados ou revogados de um pedido. |
| `TrackingAccessToken` | índice composto em `order_id, revoked_at, expires_at` | Buscar tokens válidos de um pedido e suportar rotação/revogação. |
| `TrackingAccessToken` | índice em `expires_at` | Limpeza ou expiração operacional de tokens antigos. |
| `Order` | índice em `display_id` | Busca operacional/admin. |
| `Order` | unique em `order_analytics_id` | Identificador seguro para eventos externos e analytics sem expor `order_id` interno. |
| `Order` | unique ou índice em `order_public_ref` | Referência pública para cliente/suporte e busca operacional sem expor ID interno. |
| `Order` | índice em `order_status` | Filtrar pedidos por ciclo operacional no Admin e em rotinas de operação. |
| `Order` | índice em `payment_status` | Filtrar pedidos por estado financeiro, reembolsos e conciliação. |
| `Order` | índice composto em `order_status, payment_status` | Consultas operacionais combinadas, como pedidos enviados e reembolsados, ou pedidos que exigem atenção financeira/operacional. |
| `Payment` | índice em `order_id` | Listar pagamentos associados ao pedido e calcular estado financeiro agregado. |
| `Payment` | unique ou índice em `stripe_payment_intent_id` quando não nulo | Correlacionar pagamento confirmado com PaymentIntent e webhooks Stripe. |
| `Payment` | índice em `status` | Consultar pagamentos capturados, reembolsados e parcialmente reembolsados. |
| `Payment` | índice composto em `order_id, status` | Suportar agregação financeira de `Order.payment_status`. |
| `Payment` | índice em `captured_at` | Suportar conciliação financeira e auditoria temporal. |
| `Payment` | check/constraint: `amount >= 0` e valor inteiro | Impedir valor de pagamento negativo e garantir menor unidade monetária. |
| `Payment` | check/constraint: `captured_amount >= 0` e valor inteiro | Impedir captura negativa e garantir menor unidade monetária. |
| `Payment` | check/constraint: `captured_amount <= amount` | Impedir valor capturado maior que o valor autorizado/esperado. |
| `Payment` | check/constraint MVP: `currency_code = BRL` | Impedir pagamento em moeda fora do escopo inicial. |
| `Refund` | índice em `order_id` | Listar reembolsos associados ao pedido. |
| `Refund` | índice em `payment_id` | Correlacionar reembolsos ao pagamento de origem. |
| `Refund` | unique em `stripe_refund_id` quando não nulo | Impedir duplicidade de reembolso confirmado pelo Stripe. |
| `Refund` | índice em `status` | Consultar reembolsos pendentes, processando, concluídos ou falhos. |
| `Refund` | índice composto em `payment_id, status` | Calcular agregação financeira e bloquear reembolso acima do capturado. |
| `Refund` | unique parcial em `payment_id` para status em `requested` ou `processing` | Impedir solicitações concorrentes de reembolso para o mesmo pagamento. |
| `Refund` | índice composto em `order_id, status` | Calcular `Order.payment_status` agregado e conciliação operacional. |
| `Refund` | índice composto em `requested_by_admin_id, requested_at` | Auditoria de ações administrativas de reembolso. |
| `Refund` | check/constraint: `amount > 0` e valor inteiro | Impedir reembolso zero, negativo ou com unidade monetária inválida. |
| `Refund` | validação transacional: `currency_code = Payment.currency_code` | Impedir reembolso em moeda divergente do pagamento original. |
| `Refund` | check/constraint MVP: `currency_code = BRL` | Impedir reembolso em moeda fora do escopo inicial. |
| `Refund` | validação transacional de saldo: `amount <= Payment.captured_amount - soma(refunds succeeded/requested/processing)` | Impedir reembolso acima do saldo capturado disponível, incluindo valores confirmados e bloqueados. |
| `Fulfillment` | índice em `gelato_order_id` | Processar webhooks Gelato por campo top-level canônico. |
| `Fulfillment` | unique parcial em `gelato_order_id` quando não nulo e ativo | Evitar duplicidade de pedido Gelato ativo. |
| `Fulfillment` | unique parcial em `idempotency_key` para fulfillments ativos | Impedir criação duplicada de fulfillment Gelato para o mesmo `Order`. |
| `Fulfillment` | índice em `order_id` | Consultar fulfillment por pedido. |
| `Fulfillment` | índice em `status` | Filtrar fulfillments pendentes, falhos, enviados e entregues. |
| `Fulfillment` | índice em `status, next_retry_at` | Localizar fulfillments elegíveis para retry. |
| `Fulfillment` | índice em `requires_attention_reason` quando não nulo | Filtrar causas de atenção operacional no Admin. |
| `ExchangeRequest` | índice em `order_id` | Consultar trocas por pedido. |
| `ExchangeRequest` | unique composto em `order_id, exchange_number_for_order` | Impedir duplicidade do número sequencial da troca no mesmo pedido. |
| `ExchangeRequest` | índice em `status` | Filtrar trocas pendentes, aprovadas, em postagem, recebidas, concluídas, recusadas ou canceladas. |
| `ExchangeRequest` | índice em `requested_channel` | Auditar origem das solicitações de troca. |
| `ExchangeRequest` | índice em `provider` | Filtrar trocas com logística reversa registrada por provedor. |
| `ExchangeRequest` | índice em `reverse_logistics_code` quando não nulo | Localizar troca por código de logística reversa dos Correios. |
| `ExchangeRequest` | índice composto em `order_id, status` | Consultar histórico operacional de trocas de um pedido por estado. |
| `EmailDeliveryLog` | índice em `entity_type, entity_id` | Consultar e-mails associados a pedidos, reembolsos, trocas, clientes ou alertas. |
| `EmailDeliveryLog` | índice em `email_type` | Filtrar mensagens por tipo transacional. |
| `EmailDeliveryLog` | índice em `status` | Localizar e-mails pendentes, falhos, reprocessáveis ou enviados. |
| `EmailDeliveryLog` | unique em `idempotency_key` | Impedir duplicidade de envio para o mesmo escopo lógico. |
| `EmailDeliveryLog` | unique em `resend_message_id` quando não nulo | Correlacionar retorno do provedor e evitar duplicidade técnica. |
| `EmailDeliveryLog` | índice em `recipient` | Auditoria e suporte operacional, respeitando LGPD. |
| `EmailDeliveryLog` | índice em `next_retry_at` quando `status = retrying` | Localizar mensagens elegíveis para retry. |
| `EmailDeliveryLog` | índice composto em `email_type, status` | Monitorar falhas por tipo de e-mail. |
| `AnalyticsEventLog` | unique em `idempotency_key` | Impedir duplicidade de eventos analíticos críticos, especialmente `purchase_completed`. |
| `AnalyticsEventLog` | índice em `order_id` | Consultar eventos analíticos associados ao pedido. |
| `AnalyticsEventLog` | índice composto em `event_name, status` | Monitorar eventos registrados, enfileirados, enviados ou falhos por tipo. |
| `AnalyticsEventLog` | índice composto em `provider, provider_event_id` quando `provider_event_id` não nulo | Correlacionar retorno do provedor externo. |
| `OperationalAlert` | índice composto em `status, severity` | Filtrar alertas abertos por severidade. |
| `OperationalAlert` | índice composto em `entity_type, entity_id` | Consultar alertas associados a pedidos, fulfillments ou outras entidades. |
| `OperationalAlert` | índice composto em `type, created_at` | Investigar frequência e histórico de alertas por tipo. |
| `AdminActionLog` | índice em `admin_id` | Auditar ações por administrador. |
| `AdminActionLog` | índice em `action` | Filtrar ações administrativas por tipo. |
| `AdminActionLog` | índice composto em `entity_type, entity_id` | Consultar histórico administrativo de uma entidade. |
| `AdminActionLog` | índice em `result` | Filtrar ações bem-sucedidas, falhas ou bloqueadas. |
| `AdminActionLog` | índice em `created_at` | Auditoria temporal e investigação de incidentes. |
| `AdminActionLog` | índice em `metadata.correlation_id` quando persistido em JSONB | Correlacionar ação administrativa com logs, webhooks, e-mails ou alertas. |
| `AdminActionLog` | índice composto em `admin_id, created_at` | Revisar atividade administrativa por período. |
| `AdminActionLog` | índice composto em `action, result` | Monitorar falhas ou bloqueios por tipo de ação. |

---

## 9. Observações de Implementação

- A implementação deve priorizar entidades nativas do Medusa.
- `PaymentAttempt` é customizada e recomendada para tornar explícita a camada pré-Order.
- Se o Medusa já persistir todos os dados necessários para `PaymentCollection` e `PaymentSession`, não é necessário duplicar essas entidades em tabelas customizadas; o documento ainda deve tratá-las como entidades lógicas do modelo.
- Nenhuma entidade pré-Order deve ser usada como substituta de `Order` em relatórios de receita.
- O `LineItem` do `Order` deve ser tratado como snapshot comercial/produtivo do item vendido, não como simples ponte dinâmica para a `ProductVariant`.
- O snapshot Gelato deve ser capturado antes do fulfillment e deve permanecer imutável para preservar a semântica do pedido.
- Reprocessamentos Gelato devem reconstruir o payload com base em `LineItem.metadata.gelato_snapshot`.
- Alterações em `ProductVariant.metadata` devem afetar apenas novos carrinhos/pedidos, nunca pedidos já confirmados.
- `CheckoutCompletionLog` deve ser tratado como controle de operação/idempotência, não como entidade comercial.
- A criação do `CheckoutCompletionLog` deve usar operação atômica, lock, transação ou `upsert` com constraint única em `idempotency_key`.
- `WebhookEventLog` deve ser tratado como registro técnico de eventos externos, não como fonte primária de estado comercial.
- O processamento de webhook deve primeiro validar autenticidade/assinatura, calcular `payload_hash` e `deduplication_key`, registrar ou localizar `WebhookEventLog`, aplicar idempotência e só então executar efeitos de negócio permitidos.
- `WebhookEventLog.deduplication_key` deve ser calculada de forma determinística. Quando `external_event_id` for confiável, ela deve derivar desse ID; quando não for, deve derivar de payload normalizado ou de campos externos estáveis definidos no contrato da integração.
- Eventos duplicados devem retornar resposta segura ao provedor sem duplicar efeitos internos.
- Webhooks Stripe que confirmam pagamento devem ser correlacionados com `PaymentAttempt` por `stripe_payment_intent_id` e com `CheckoutCompletionLog` pela chave de idempotência definida.
- Webhooks Gelato devem ser correlacionados com `Fulfillment` por `gelato_order_id` ou identificador equivalente validado.
- `Fulfillment.idempotency_key` deve ser definida antes da chamada de criação Gelato, para bloquear duplicidade antes de qualquer retry.
- Falhas recuperáveis na Gelato devem usar retry com backoff, atualizando `retry_count`, `last_retry_at` e `next_retry_at`.
- Falhas persistentes ou irrecuperáveis devem preencher `last_error_code`, `last_error_message` e `requires_attention_reason`, além de mover o pedido para `requires_attention` quando aplicável.
- Reprocessamento manual pelo Admin deve reutilizar o fulfillment existente sempre que possível; criar novo fulfillment só deve ocorrer quando o anterior estiver cancelado, encerrado ou explicitamente substituído por regra operacional documentada.
- Webhooks Gelato fora de ordem devem ser tratados por transições permitidas; o sistema não deve regredir de `shipped` para `in_production`, por exemplo, sem regra explícita.
- `TrackingAccessToken` deve armazenar apenas hash do token; o token puro só deve existir no momento de geração e no link enviado ao cliente.
- Links de tracking devem ser tratados como credenciais temporárias de acesso anônimo; não devem aparecer em logs, eventos PostHog, Sentry ou mensagens de erro.
- Ao consultar tracking por token, o backend deve comparar hash do token recebido com `TrackingAccessToken.token_hash`, verificar expiração e revogação e só então retornar dados mínimos do pedido.
- Para cliente autenticado, tracking deve ser autorizado por posse do pedido na conta do cliente, não pelo token anônimo.
- `order_analytics_id` deve ser gerado por mecanismo não reversível, como UUID aleatório ou hash com segredo/pepper, desde que não permita inferir `order_id` interno.
- `order_public_ref` deve ser adequado para exibição ao cliente e suporte, mas não deve funcionar como credencial de acesso a dados do pedido.
- `purchase_completed` continua pertencendo ao backend e só deve ser registrado duravelmente após criação/confirmação do `Order`, conclusão bem-sucedida do `CheckoutCompletionLog` e disponibilidade de `order_analytics_id`.
- Payloads enviados ao PostHog ou ferramentas externas devem usar `order_analytics_id` ou `order_public_ref` seguro, nunca `order_id` interno.
- A entrega ao PostHog deve ocorrer de forma assíncrona via outbox/worker; falhas temporárias do provedor devem gerar retry, não bloquear Gelato.

- `Order.order_status` e `Order.payment_status` devem ser mantidos separados no domínio, mesmo que a implementação use campos nativos do Medusa combinados com metadata customizada.
- Reembolso total ou parcial deve atualizar o estado financeiro e preservar o estado operacional real do pedido.
- Cancelamento deve ser tratado como transição operacional explícita; não deve ser inferido apenas por reembolso.
- Despacho/tracking deve mover o pedido para `shipped`, não para `completed`.
- Entrega confirmada pode mover o pedido para `delivered`; `completed` deve representar fechamento operacional pós-entrega.
- Relatórios comerciais devem usar `purchase_completed`/pagamento capturado para receita e não depender de `order_status = completed`.
- `Refund` deve ser tratado como entidade financeira-operacional própria, não apenas como metadata dentro de `Payment`.
- Solicitar reembolso no Admin deve criar `Refund.status = requested` ou `processing`, mas não deve notificar cliente como reembolsado antes de confirmação do Stripe.
- Webhook Stripe de reembolso deve localizar ou atualizar `Refund`, marcar `succeeded`/`failed` conforme payload confirmado e recalcular `Payment.status` / `Order.payment_status` de forma idempotente e transacional, usando `Payment.captured_amount` como teto financeiro.
- Reembolso parcial e total devem ser calculados pelo valor acumulado de `Refund.status = succeeded` em relação ao valor capturado do pagamento.
- `Refund` não deve ser usado para inferir cancelamento operacional; cancelamento deve continuar registrado em `Order.order_status` por fluxo próprio.
- E-mail de reembolso ao cliente deve ser disparado somente após `Refund.status = succeeded`, respeitando idempotência de envio.
- `ExchangeRequest` deve ser a fonte operacional para histórico de troca no pedido.
- Solicitações recebidas por e-mail de suporte devem ser registradas manualmente pelo Admin como `ExchangeRequest.status = requested`.
- Formulário ou página de contato, quando existir, pode ajudar a coletar dados, mas não deve substituir a validação/administração da troca no MVP.
- `requested_channel` deve registrar a origem da solicitação, usando `support_email` como canal canônico do MVP.
- `exchange_number_for_order` deve ser calculado de forma transacional para evitar duas trocas com o mesmo número em um pedido.
- A regra de frete da primeira troca e de trocas adicionais deve ser aplicada na criação/aprovação da `ExchangeRequest`, não apenas exibida na UI.
- O status `awaiting_posting` deve ser aplicado somente quando o cliente já puder agir, isto é, quando existirem instruções suficientes de postagem/logística reversa.
- O status `canceled` deve ser usado para encerramento sem conclusão da troca; `rejected` deve ser reservado para recusa após análise administrativa.
- A troca não deve iniciar reembolso ou reenvio automaticamente no MVP; essas ações dependem de fluxo administrativo próprio e, para reembolso, da entidade `Refund`.
- Dados de logística reversa dos Correios no MVP são registros operacionais. A existência de `reverse_logistics_code` não implica integração automática com API dos Correios.
- `EmailDeliveryLog` deve ser a fonte operacional para auditoria de envio de e-mails transacionais e alertas por e-mail.
- A criação de `EmailDeliveryLog` deve ocorrer antes ou durante a chamada ao Resend, usando `idempotency_key` para impedir mensagens duplicadas.
- Para e-mails associados a pedido, o fluxo deve preferir `order_id + email_type` como chave de idempotência, exceto quando o tipo exigir granularidade adicional, como tracking por fulfillment ou reembolso por `refund_id`.
- E-mail de confirmação de pedido deve ser registrado e enviado após `Order` confirmado e antes da tentativa de fulfillment Gelato.
- E-mail de tracking deve referenciar `TrackingAccessToken.id` ou entidade relacionada; o token puro não deve ser persistido no log.
- E-mail de reembolso deve depender de `Refund.status = succeeded`, não da simples solicitação administrativa de reembolso.
- E-mail de instruções de troca deve depender de `ExchangeRequest` aprovada ou em `awaiting_posting`, com instruções operacionais suficientes.
- Falhas de e-mail devem ser reprocessáveis quando o erro for recuperável, atualizando `retry_count`, `last_error_code`, `last_error_message` e `next_retry_at`.
- Falha no envio de e-mail não deve alterar estados de negócio já confirmados; ela deve gerar log, possível retry e, quando crítica, alerta operacional.
- O corpo integral de e-mail não deve ser usado como log primário. Preferir `template_key`, `template_version`, entidade relacionada e metadados sanitizados.
- `recipient` deve ser tratado como dado pessoal. Acesso, exportação e retenção desses registros devem respeitar a política de privacidade/LGPD.
- `operational_alert` pode usar `EmailDeliveryLog` para registrar envio ao Admin, mas a deduplicação deve evitar tempestade de alertas em falhas recorrentes.
- `AdminActionLog` deve ser criado para ações administrativas críticas antes, durante ou imediatamente após a tentativa de execução, incluindo ações bloqueadas ou falhas quando relevantes.
- A entidade deve ser tratada como trilha de auditoria append-only; correções devem ser feitas por novos eventos de auditoria, não por edição do registro anterior.
- `AdminActionLog` deve registrar `reason` para cancelamentos, reembolsos, reprocessamentos, recusas de troca e overrides, para reduzir ambiguidade operacional.
- `AdminActionLog` não substitui `Order`, `Refund`, `Fulfillment`, `ExchangeRequest`, `EmailDeliveryLog` ou `WebhookEventLog`; ele documenta a ação administrativa e aponta para a entidade que mantém o estado real.
- Ações de reembolso devem ser auditadas em `AdminActionLog`, mas a confirmação financeira continua dependendo de `Refund.status = succeeded` após webhook Stripe.
- Reprocessamentos manuais de Gelato devem registrar `AdminActionLog` e respeitar as regras de idempotência de `Fulfillment`, sem criar segundo pedido Gelato ativo para o mesmo `Order`.
- Alterações administrativas de metadados Gelato em produtos ou variantes devem preservar snapshots de pedidos já confirmados em `LineItem.metadata.gelato_snapshot`.
- `AdminActionLog.previous_state` e `AdminActionLog.new_state` devem conter apenas campos relevantes para auditoria e não devem persistir secrets, tokens puros, dados completos de pagamento ou payloads extensos.
- O `admin_email` pode ser armazenado como conveniência operacional, mas `admin_id` deve ser a referência principal e estável.
- Quando houver `correlation_id` ou `request_id`, a ação administrativa deve ser correlacionável com logs técnicos, Sentry, webhooks, e-mails ou alertas operacionais.


---

- `AnalyticsEventLog` deve ser tratado como fonte persistida para comprovar o registro local durável de `purchase_completed`; o simples sucesso de chamada ao PostHog sem registro local não satisfaz a regra de integridade.
- O fulfillment Gelato deve verificar a existência de `AnalyticsEventLog` local durável para `purchase_completed` antes de iniciar criação do pedido de produção. `status = sent` comprova entrega externa ao PostHog, mas não é pré-condição para Gelato.
- `OperationalAlert` é entidade persistida; envio de e-mail, log textual ou Sentry não substituem o registro do alerta.
- `Fulfillment.gelato_order_id` deve ser campo top-level indexado. `metadata.gelato_order_id` não deve ser fonte canônica para lookup de webhook.
- No MVP, `Fulfillment.status = not_started` não deve ser persistido; ausência de fulfillment para `Order` confirmado representa o estado derivado de não iniciado.
- `PaymentAttempt.stripe_payment_intent_id` deve ser único quando não nulo; nova tentativa de pagamento deve usar novo PaymentIntent.
- `entity_type` deve usar os valores canônicos da seção 2.17; novos registros não devem usar aliases como `exchange` ou `alert`.
- `OperationalAlert.entity_type` deve usar `exchange_request` quando o alerta estiver associado a uma troca.
- `PaymentSession` e `PaymentAttempt` possuem fronteiras distintas: sessão/provedor no primeiro, estado operacional e idempotência de domínio no segundo.
- No MVP, `AnalyticsEventLog.event_name = purchase_completed` é o único evento analítico persistido obrigatório.
- `Order.payment_status` deve ser calculado por agregação dos pagamentos capturados e refunds confirmados, não atualizado por inferência manual isolada. `Payment.status` segue a mesma regra de recomputação denormalizada.
- Reembolsos não devem ultrapassar o valor capturado do pagamento. Reembolsos em processamento devem ser considerados no bloqueio para evitar corrida operacional.
- Overrides de custo de frete de troca são permitidos apenas com `AdminActionLog` e `reason` obrigatório.
- Entidades de log e auditoria devem ser append-only em fluxo normal; correções manuais devem gerar novo registro, não sobrescrever histórico.
