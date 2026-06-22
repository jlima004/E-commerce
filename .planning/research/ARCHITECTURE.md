# Architecture Research

**Domain:** Backend headless de e-commerce Print-on-Demand (POD) de camisetas — Brasil/BRL, sobre Medusa v2
**Researched:** 2026-06-22
**Confidence:** HIGH (mecanismos Medusa v2 verificados em docs oficiais via Context7; integração Gelato é MEDIUM — módulo custom, sem provider oficial)

> **Tese central:** O fluxo padrão de checkout do Medusa (`completeCart`/`placeOrder` disparado pelo storefront no `return_url` do Stripe) **cria o Order antes da confirmação confiável do pagamento**. Este projeto **inverte** esse fluxo: o Order só nasce a partir do **webhook canônico do Stripe**, processado de forma idempotente no backend. Toda a arquitetura abaixo existe para sustentar essa inversão e as 12 invariantes.

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        BORDA / API (HTTP)                                  │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ Store API  │  │ Admin API +  │  │ Webhook IN   │  │ Tracking público│  │
│  │ (cart,     │  │ Admin Panel  │  │ /hooks/...    │  │ (token-gated)   │  │
│  │  checkout) │  │ (refund/troca│  │ stripe|gelato │  │                 │  │
│  └─────┬──────┘  └──────┬───────┘  └──────┬───────┘  └────────┬────────┘  │
│        │                │                 │                   │           │
├────────┼────────────────┼─────────────────┼───────────────────┼───────────┤
│        ▼                ▼                 ▼                   ▼           │
│                  CAMADA DE ORQUESTRAÇÃO (Medusa Workflows + Subscribers)   │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │ checkoutCompletionWorkflow │ ingestStripeWebhookWf │ gelatoFulfillWf  │ │
│  │ recordPurchaseCompletedWf  │ ingestGelatoWebhookWf │ refundWf         │ │
│  │ Subscribers: order.created → analytics → email → (gate) fulfillment   │ │
│  │ Outbox dispatcher (scheduled job): AnalyticsEventLog, EmailDelivery    │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────────────────  │
│                  CAMADA DE MÓDULOS (domínio)                               │
│  Core Medusa:   ┌────────┐ ┌──────────┐ ┌─────────┐ ┌────────────┐         │
│                 │ Cart   │ │ Payment  │ │ Order   │ │ Fulfillment│         │
│                 └────────┘ └────┬─────┘ └────┬────┘ └─────┬──────┘         │
│  Providers:        Stripe PP ───┘            │        Gelato FP ──┐        │
│  Custom modules:                                                  │        │
│   payment_ops(PaymentAttempt) · checkout(CheckoutCompletionLog)   │        │
│   webhooks(WebhookEventLog)   · analytics_outbox(AnalyticsEventLog)│        │
│   gelato(GelatoOrder+webhook) · tracking(TrackingAccessToken)     │        │
│   notifications(EmailDeliveryLog/Resend) · ops(OperationalAlert,  │        │
│   AdminActionLog)                                                 │        │
├──────────────────────────────────────────────────────────────────┼────────┤
│                  PERSISTÊNCIA / INFRA                              │        │
│  ┌────────────┐  ┌──────────┐  ┌───────────────┐  ┌────────────┐  │        │
│  │ PostgreSQL │  │  Redis    │  │ Supabase      │  │ Stripe/    │◄─┘        │
│  │ /Supabase  │  │ (events,  │  │ Storage (img) │  │ Gelato/    │           │
│  │ (verdade)  │  │  queues,  │  │               │  │ Resend/    │           │
│  │            │  │  workflow)│  │               │  │ PostHog    │           │
│  └────────────┘  └──────────┘  └───────────────┘  └────────────┘           │
└────────────────────────────────────────────────────────────────────────  │
```

### Component Responsibilities

| Component | Responsibility (o que possui) | Implementação típica em Medusa v2 |
|-----------|-------------------------------|-----------------------------------|
| **Cart / Payment Collection / Payment Session** | Estado pré-Order do checkout; sessão de pagamento Stripe | Módulos core `cart` + `payment`; Stripe Payment Provider |
| **payment_ops (`PaymentAttempt`)** | Trilha operacional da tentativa: `cart_id`, `payment_intent_id`, estado de UX (`pix_qr_displayed`, `awaiting_pix_payment`, `pix_expired`, `card_client_confirmed`), correlação assíncrona | Módulo custom (data model + service) |
| **webhooks (`WebhookEventLog`)** | Recebimento, validação, deduplicação e idempotência de **todo** evento externo (Stripe e Gelato) | Módulo custom + rotas `/hooks/*`; `unique(provider, deduplication_key)` |
| **checkout (`CheckoutCompletionLog`)** | Idempotência da **operação interna** "concluir checkout → criar Order" | Módulo custom; `unique(idempotency_key)` |
| **Order (core)** | Pedido confirmado — só nasce pós-webhook aprovado | Módulo core `order` via workflow |
| **analytics_outbox (`AnalyticsEventLog`)** | Outbox local durável de `purchase_completed`; entrega assíncrona reprocessável ao PostHog | Módulo custom + scheduled job dispatcher |
| **notifications (`EmailDeliveryLog`)** | E-mails transacionais/alertas via Resend, idempotentes e auditáveis | Notification module / módulo custom + Resend provider |
| **gelato (`GelatoOrder` + webhook)** | Submissão de produção, estado Gelato, ingestão de webhook Gelato | Módulo custom; opcionalmente Fulfillment Provider |
| **Fulfillment (core) + `Fulfillment.gelato_order_id`** | Fulfillment Medusa correlacionado ao pedido Gelato (lookup canônico) | Módulo core `fulfillment` + link |
| **tracking (`TrackingAccessToken`)** | Acesso anônimo seguro ao tracking de convidados (somente hash) | Módulo custom; `token_hash`, expiração, revogação |
| **refunds/exchanges (`Refund`, `ExchangeRequest`)** | Estado financeiro de reembolso (pós-webhook) e troca operacional | Módulos custom + Admin |
| **ops (`OperationalAlert`, `AdminActionLog`)** | Alertas críticos persistidos; auditoria de ações administrativas | Módulos custom |

---

## Recommended Project Structure

```
src/
├── modules/
│   ├── payment-ops/            # PaymentAttempt: trilha operacional da tentativa
│   │   ├── models/payment-attempt.ts
│   │   ├── service.ts
│   │   └── index.ts
│   ├── webhooks/               # WebhookEventLog: idempotência de eventos externos
│   │   ├── models/webhook-event-log.ts
│   │   ├── service.ts          # recordEvent(), markProcessed(), isDuplicate()
│   │   └── index.ts
│   ├── checkout/               # CheckoutCompletionLog: idempotência de criação de Order
│   │   ├── models/checkout-completion-log.ts
│   │   └── service.ts
│   ├── analytics-outbox/       # AnalyticsEventLog: outbox de purchase_completed
│   │   ├── models/analytics-event-log.ts
│   │   └── service.ts
│   ├── gelato/                 # GelatoOrder + client + provider de fulfillment
│   │   ├── models/gelato-order.ts
│   │   ├── client.ts           # SDK/HTTP Gelato (secrets via env)
│   │   └── service.ts
│   ├── tracking/               # TrackingAccessToken (token_hash)
│   │   ├── models/tracking-access-token.ts
│   │   └── service.ts          # issue(), verify(), revoke() — nunca plaintext
│   ├── refunds/                # Refund (estado financeiro)
│   ├── exchanges/              # ExchangeRequest
│   ├── notifications-resend/   # EmailDeliveryLog + Resend provider
│   └── ops/                    # OperationalAlert + AdminActionLog
├── workflows/
│   ├── checkout-completion.ts          # cria Order idempotente pós-webhook
│   ├── ingest-stripe-webhook.ts        # valida + persiste + roteia
│   ├── record-purchase-completed.ts    # grava outbox local durável
│   ├── gelato-fulfillment.ts           # submete produção (gated, single-active)
│   ├── ingest-gelato-webhook.ts        # atualiza Fulfillment/tracking
│   ├── refund.ts                       # estado financeiro pós-webhook
│   └── steps/                          # steps reutilizáveis + compensações
├── subscribers/
│   ├── order-created.ts        # → record-purchase-completed → email → gate fulfillment
│   └── purchase-completed.ts   # → enfileira gelato-fulfillment
├── jobs/                       # scheduled
│   ├── analytics-outbox-dispatch.ts    # entrega PostHog (reprocessável)
│   ├── email-outbox-dispatch.ts        # retries Resend
│   └── pix-expiry-sweeper.ts           # marca PaymentAttempt pix_expired
├── api/
│   ├── hooks/
│   │   ├── stripe/route.ts     # webhook canônico Stripe (raw body + assinatura)
│   │   └── gelato/route.ts     # webhook Gelato (assinatura)
│   ├── store/tracking/route.ts # acesso anônimo via TrackingAccessToken
│   └── admin/                  # refund/troca/reprocessamento (→ AdminActionLog)
├── links/                      # defineLink: custom models ↔ Order/Payment/Fulfillment
└── medusa-config.ts            # módulos, providers, redis (event+workflow engine)
```

### Structure Rationale

- **`modules/`:** cada log/entidade custom do DB_MODEL é um módulo isolado com data model + service. Isso respeita o isolamento de módulos do Medusa v2 (sem FK cross-module — associação via **module links**).
- **`workflows/`:** toda mutação de domínio crítica passa por workflow para ganhar **compensação (rollback)**, retries e durabilidade. Webhooks e subscribers apenas **disparam** workflows.
- **`subscribers/`:** acoplamento assíncrono entre "Order criado" → analytics → e-mail → liberação de fulfillment, sem amarrar o caminho crítico de pagamento à entrega externa.
- **`jobs/`:** os dispatchers do outbox (PostHog/Resend) ficam fora do caminho de fulfillment — entrega externa é eventual e reprocessável.
- **`api/hooks/`:** endpoints dedicados com **raw body** (necessário para validar assinatura Stripe/Gelato).

---

## Architectural Patterns

### Pattern 1: Webhook-Driven Order Creation (inversão do fluxo padrão)

**What:** O Order **não** é criado pelo storefront ao retornar do Stripe. O webhook canônico Stripe (`payment_intent.succeeded` / `charge.succeeded` conforme método) é a **única** fonte que dispara a criação do Order.
**When to use:** Sempre neste projeto — é a base das invariantes 1, 2 e 4.
**Trade-offs:** (+) elimina cobrança fantasma e Order sem pagamento; (+) suporta Pix assíncrono naturalmente. (−) UX de confirmação precisa de polling/estado em `PaymentAttempt` (Order ainda não existe quando o cliente volta da tela de pagamento); (−) diverge do "happy path" documentado do Medusa, exigindo desabilitar/ignorar `placeOrder` direto.

**Example:**
```typescript
// api/hooks/stripe/route.ts — apenas valida + delega ao workflow (idempotência lá dentro)
export const POST = async (req, res) => {
  const event = stripe.webhooks.constructEvent(req.rawBody, req.headers["stripe-signature"], secret)
  await ingestStripeWebhookWorkflow(req.scope).run({ input: { event } })
  res.status(200).json({ received: true }) // sempre 200 após persistir; reprocessa via log
}
```

### Pattern 2: Transactional Outbox (purchase_completed e e-mail)

**What:** `purchase_completed` é gravado em `AnalyticsEventLog` **na mesma fronteira transacional** da confirmação do Order (status `recorded`). Um job assíncrono entrega ao PostHog e move para `queued→sent|failed`. O mesmo padrão vale para `EmailDeliveryLog`.
**When to use:** Para qualquer efeito externo que não pode bloquear nem corromper o estado de domínio (invariantes 5, 7).
**Trade-offs:** (+) durabilidade independente de PostHog/Resend; (+) reprocessável. (−) requer dispatcher + estados de outbox; entrega é "at-least-once" (idempotency_key no payload externo).

**Example:**
```typescript
// dentro do checkout-completion workflow, após criar o Order, no mesmo fluxo:
const ev = recordPurchaseCompletedStep({ order_id, order_analytics_id }) // status: "recorded"
// fulfillment depende deste registro local — NÃO do PostHog
```

### Pattern 3: Idempotency Key + Unique Constraint (defesa em duas camadas)

**What:** Toda operação reentrante carrega uma chave determinística e o banco possui `unique` correspondente. Webhook: `unique(provider, deduplication_key)`. Criação de Order: `CheckoutCompletionLog.unique(idempotency_key)` derivada de `payment_intent_id` (ou `cart_id + payment_intent_id`). Gelato: garantir **um** pedido ativo por Order.
**When to use:** Webhooks reentregam; jobs reexecutam; usuários dão duplo-clique. Sempre.
**Trade-offs:** (+) corretude garantida pelo banco mesmo sob corrida/concorrência. (−) exige cuidado na derivação da chave (normalização) e tratamento de violação de unicidade como "já processado".

**Example:**
```typescript
// step de criação de Order: lê-ou-cria CheckoutCompletionLog antes de criar Order
const log = await checkoutSvc.getOrCreate({ idempotency_key })  // unique
if (log.status === "completed") return new StepResponse({ order_id: log.order_id }) // no-op idempotente
// ... cria Order, preenche log.order_id, atualiza PaymentAttempt.order_id — transacional
```

### Pattern 4: Single-Active-Gelato Gate (invariante 8)

**What:** Antes de submeter à Gelato, um step verifica que não existe `GelatoOrder` ativo para aquele `order_id` (`unique(order_id) WHERE status IN (active states)`, ou estado `submitting` reservado atomicamente). Reprocessamento manual exige flag explícita + `AdminActionLog`.
**Trade-offs:** (+) impede duplicidade de produção/custo. (−) reprocessamento legítimo precisa de caminho administrativo controlado.

---

## Data Flow

### Fluxo principal: checkout → Order pago → fulfillment Gelato

```
Cliente cria Cart → Payment Collection → Payment Session (Stripe)
        │
        ▼
PaymentAttempt criado (cart_id, payment_intent_id, status=initiated)
   estado de UX (pix_qr_displayed / card_client_confirmed) gravado aqui
        │   (Order ainda NÃO existe)
        ▼
Stripe processa pagamento ──(assíncrono p/ Pix)──► Stripe envia WEBHOOK
        │
        ▼  POST /hooks/stripe (raw body)
[1] valida assinatura  → [2] WebhookEventLog.recordEvent(dedup_key)  ──► duplicado? 200 no-op
        │ (status=received → processing)
        ▼
ingestStripeWebhookWorkflow:
   payment_intent.succeeded?
        │ sim → checkoutCompletionWorkflow(idempotency_key = payment_intent_id)
        │          ├─ CheckoutCompletionLog get-or-create (unique)
        │          ├─ cria Order (core) + Payment captured        ┐ mesma
        │          ├─ AnalyticsEventLog.purchase_completed=recorded│ fronteira
        │          ├─ log.order_id + PaymentAttempt.order_id       ┘ transacional
        │          └─ emit "order.created"
        │ pending/expired/failed/canceled → atualiza PaymentAttempt; NÃO cria Order
        ▼
Subscriber order.created:
   → EmailDeliveryLog confirmação (Resend) [antes da tentativa Gelato]
   → emit "purchase_completed" (local) → gate
        ▼
Subscriber purchase_completed (gate de fulfillment):
   exige: Order confirmado + AnalyticsEventLog(purchase_completed) durável local
   (NÃO exige status=sent nem sucesso PostHog)
        ▼
gelatoFulfillmentWorkflow:
   single-active gate (sem GelatoOrder ativo) → submete à Gelato → GelatoOrder=submitted
        ▼
Gelato produz/envia ──► WEBHOOK Gelato → /hooks/gelato
   → WebhookEventLog (dedup) → atualiza Fulfillment.gelato_order_id, status, tracking
        ▼
TrackingAccessToken emitido (token_hash) → link de tracking para convidado

(paralelo, fora do caminho crítico)
analytics-outbox-dispatch job: AnalyticsEventLog recorded→queued→sent|failed (PostHog)
```

### Fluxo de reembolso (invariantes 9, 10)

```
Admin solicita refund → Refund(status=requested) + AdminActionLog
   (bloqueia refund concorrente requested/processing por Payment;
    bloqueia valor acima do capturado)
        ▼
chama Stripe refund → aguarda WEBHOOK (charge.refunded / refund.updated)
        ▼
/hooks/stripe → WebhookEventLog → refundWorkflow
   atualiza estado FINANCEIRO do Refund (succeeded/failed)
   ❌ NÃO altera order_status para canceled (desacoplado)
```

### Key Data Flows

1. **Verdade financeira:** sempre o webhook Stripe persistido (`WebhookEventLog`), nunca o retorno do cliente nem o estado de UX em `PaymentAttempt`.
2. **Gate de fulfillment:** depende exclusivamente de estado **local durável** (Order confirmado + `AnalyticsEventLog` registrado), desacoplado de PostHog/Resend.
3. **Entrega externa (PostHog/Resend):** eventual, reprocessável, via jobs de outbox; falha não corrompe domínio.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0–1k pedidos/mês | Monolito Medusa único; worker e server no mesmo host (PM2). Redis para event/workflow engine já suficiente. |
| 1k–100k | Separar **worker mode** do **server mode** (config Medusa); dispatchers de outbox em job dedicado; índices em `payment_intent_id`, `deduplication_key`, `order_id`. Pool de conexões Postgres ajustado. |
| 100k+ | Webhooks com fila dedicada (Redis Streams/queue) e backpressure; réplicas de leitura para tracking/relatórios; particionar tabelas de log (`WebhookEventLog`, `AnalyticsEventLog`) por data; rate-limit no endpoint de tracking. |

### Scaling Priorities

1. **Primeiro gargalo — ingestão de webhook + criação de Order:** garantir endpoint rápido (só persiste e enfileira) e processamento idempotente assíncrono. Resolver com worker mode + fila antes de qualquer otimização de leitura.
2. **Segundo gargalo — tabelas de log crescendo:** `WebhookEventLog`/`AnalyticsEventLog`/`EmailDeliveryLog` crescem rápido; políticas de retenção/particionamento e índices diagnósticos (não-únicos) em `metadata`.

---

## Anti-Patterns

### Anti-Pattern 1: Criar Order no `return_url`/storefront (fluxo padrão Medusa)

**What people do:** Usar `placeOrder(cartId)` quando o cliente volta do Stripe (como nos starters oficiais).
**Why it's wrong:** Pix é assíncrono e cartão pode falhar pós-redirect; cria Order sem pagamento confirmado (viola invariantes 1, 2).
**Do this instead:** Order criado **somente** pelo webhook canônico via `checkoutCompletionWorkflow`. O retorno do cliente apenas consulta `PaymentAttempt.client_confirmation_state` (polling).

### Anti-Pattern 2: Tratar `WebhookEventLog` como substituto de `CheckoutCompletionLog`

**What people do:** Usar a deduplicação do webhook para também garantir Order único.
**Why it's wrong:** São responsabilidades diferentes; um mesmo evento pode rotear para múltiplas operações e reentregas variam. O DB_MODEL é explícito: webhooks Stripe aprovados acionam **ambos**.
**Do this instead:** `WebhookEventLog` controla recebimento/idempotência do evento externo; `CheckoutCompletionLog` controla a operação interna de criar Order.

### Anti-Pattern 3: Acoplar fulfillment ao sucesso do PostHog

**What people do:** Esperar `AnalyticsEventLog.status = sent` (entrega ao PostHog) para liberar Gelato.
**Why it's wrong:** Indisponibilidade do PostHog bloquearia produção (viola invariante 7).
**Do this instead:** Gate exige apenas registro **local durável** (`recorded`). Entrega ao PostHog é assíncrona/reprocessável.

### Anti-Pattern 4: Logar payload bruto de webhook/segredos

**What people do:** `logger.info(req.body)` no handler de webhook.
**Why it's wrong:** Vaza secrets, dados de cartão e tokens (viola invariante 12).
**Do this instead:** Logar apenas IDs/correlação; `payload_hash` para diagnóstico; redaction central no logger; tokens só como `token_hash`.

### Anti-Pattern 5: FK cross-module entre data models custom e core

**What people do:** Definir foreign keys diretas de `PaymentAttempt`/`GelatoOrder` para `order`.
**Why it's wrong:** Módulos Medusa v2 são isolados; FK cross-module quebra o modelo de isolamento.
**Do this instead:** `defineLink(...)` para associar `Order` ↔ models custom; consultar via Query graph.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes / gotchas |
|---------|---------------------|-----------------|
| **Stripe** | Payment Provider module + webhook canônico em `/hooks/stripe` (raw body, `constructEvent`) | Pix mapeia em fluxo assíncrono (família de métodos async como PromptPay/OXXO no provider oficial). **Verifique suporte a Pix do provider Stripe do Medusa** — pode exigir provider custom estendendo `AbstractPaymentProvider` + `getWebhookActionAndData`. **MEDIUM confidence.** |
| **Gelato** | Módulo custom (client HTTP) + webhook em `/hooks/gelato` (validar assinatura) | Sem provider oficial Medusa. Metadados Gelato obrigatórios nas variantes. `Fulfillment.gelato_order_id` é o lookup canônico (não `WebhookEventLog.metadata`). |
| **Resend** | Notification provider / módulo custom + `EmailDeliveryLog` | Idempotência por `idempotency_key`; retries via job; correlação com Order/Refund/Exchange/OperationalAlert. |
| **PostHog** | Sink do outbox `AnalyticsEventLog` (job assíncrono) | Nunca enviar `order_id` interno — usar `order_analytics_id`. Falha não bloqueia domínio. |
| **Sentry** | Captura de exceções no backend (server + worker) | Não logar secrets nos breadcrumbs; redaction. |
| **Supabase Storage** | Imagens de produto | Acesso por URL assinada/política; fora do caminho transacional. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Webhook routes ↔ workflows | Disparo de workflow (run) | Rota só valida + persiste + delega; idempotência no workflow/log. |
| Order (core) ↔ PaymentAttempt/GelatoOrder/Tracking | **Module links** (`defineLink`) + Query graph | Sem FK cross-module. |
| Subscribers ↔ workflows | Event Module (`emit`) → subscriber → `workflow.run` | `order.created`, `purchase_completed` são eventos de domínio internos. |
| Domínio ↔ entrega externa | Outbox (DB) + scheduled job | Desacopla corretude de disponibilidade externa. |

---

## Invariant → Enforcement Mechanism Map

| # | Invariante | Mecanismo arquitetural de enforcement |
|---|------------|----------------------------------------|
| 1 | Order nunca antes de pagamento confiável | **Webhook-Driven Order Creation**: Order só via `checkoutCompletionWorkflow` disparado pelo webhook Stripe canônico. Storefront `placeOrder` desabilitado. |
| 2 | Pix pending/expired/cancelled/failed não cria Order | Esses estados ficam em `PaymentAttempt.client_confirmation_state` / `PaymentSession`; workflow só cria Order no evento `succeeded`. `pix-expiry-sweeper` marca expiração sem tocar Order. |
| 3 | Webhook validado, persistido, idempotente | Rota `/hooks/stripe` valida assinatura (raw body) → `WebhookEventLog.recordEvent` com `unique(provider, deduplication_key)`; reentrega = no-op 200. |
| 4 | Criação de Order idempotente por payment_intent_id (ou cart_id+pi) | `CheckoutCompletionLog.unique(idempotency_key)` derivada de `payment_intent_id`/`cart_id+pi`; get-or-create; se `completed`, retorna `order_id` existente. |
| 5 | purchase_completed é evento de domínio backend/outbox | Gravado em `AnalyticsEventLog` (status `recorded`) dentro do workflow de conclusão, no backend — não originado do frontend. |
| 6 | Fulfillment depende de Order confirmado + purchase_completed local durável | Subscriber-gate verifica Order confirmado **e** `AnalyticsEventLog(purchase_completed)` local antes de `gelatoFulfillmentWorkflow`. |
| 7 | Fulfillment não depende de status=sent nem PostHog | Gate lê apenas `recorded` (estado local); entrega PostHog é job de outbox separado, irrelevante para o gate. |
| 8 | Um Order → no máximo um Gelato ativo (salvo reprocesso manual) | **Single-Active-Gate**: `unique`/estado reservado em `GelatoOrder` por `order_id`; reprocessamento exige flag explícita + `AdminActionLog`. |
| 9 | Refund local só altera estado financeiro após webhook Stripe | `Refund` fica `requested/processing` até webhook (`charge.refunded`); só então `refundWorkflow` muda estado financeiro. Bloqueio de refunds concorrentes e acima do capturado. |
| 10 | Refund não muda order_status para canceled | `refundWorkflow` toca apenas estado financeiro do `Refund`; `order_status` desacoplado e inalterado. |
| 11 | Tracking tokens nunca em plaintext | Módulo `tracking` persiste somente `token_hash` (+ expiração/revogação); validação server-side compara hash. |
| 12 | Secrets/cartão/tokens puros nunca em logs | Logger com redaction central; webhooks logam só IDs/correlação + `payload_hash`; Sentry com scrubbing; nunca logar `req.body` bruto. |

---

## Suggested Build Order (dependências entre componentes)

> Cada fase entrega um bloco verificável. A ordem respeita: infra → idempotência → criação de Order → outbox → fulfillment → segurança/ops.

1. **Fundação:** setup Medusa v2 + Postgres/Supabase + Redis (event & workflow engine) + Admin em subdomínio + Sentry/logging estruturado com redaction. *(habilita tudo; invariante 12 começa aqui)*
2. **Catálogo & mídia:** produtos/variantes/preços BRL + metadados Gelato obrigatórios + Supabase Storage. *(pré-requisito de carrinho e de fulfillment)*
3. **Carrinho & checkout (pré-Order):** Cart + Payment Collection/Session Stripe + módulo `payment-ops` (`PaymentAttempt`) com estados de UX. *(base das invariantes 2)*
4. **Ingestão de webhook:** módulo `webhooks` (`WebhookEventLog`) + rota `/hooks/stripe` validada e idempotente. *(invariante 3; pré-requisito de criação de Order)*
5. **Criação de Order idempotente:** módulo `checkout` (`CheckoutCompletionLog`) + `checkoutCompletionWorkflow` disparado pelo webhook. *(invariantes 1, 4)*
6. **Analytics outbox:** `AnalyticsEventLog` + `record-purchase-completed` no workflow + job dispatcher PostHog. *(invariantes 5, 7)*
7. **E-mail transacional:** `notifications-resend` (`EmailDeliveryLog`) + subscriber `order.created` (antes da tentativa Gelato).
8. **Fulfillment Gelato:** módulo `gelato` (`GelatoOrder`) + single-active gate + `gelatoFulfillmentWorkflow` + webhook Gelato + `Fulfillment.gelato_order_id`. *(invariantes 6, 7, 8)*
9. **Tracking seguro:** módulo `tracking` (`TrackingAccessToken`) + rota pública token-gated. *(invariante 11)*
10. **Reembolsos & trocas:** `Refund` + `refundWorkflow` (pós-webhook) + `ExchangeRequest` + Correios manual. *(invariantes 9, 10)*
11. **Operação & auditoria:** `OperationalAlert` + `AdminActionLog` + health check.
12. **Testes críticos:** cobrir as 12 invariantes (idempotência de webhook/Order, gate de fulfillment, single-active Gelato, reembolso desacoplado, redaction de logs).

**Dependências-chave:** 4→5 (webhook antes de Order), 5→6→8 (Order → outbox → fulfillment gated), 3→5 (PaymentAttempt correlaciona Order), 1 atravessa todas (redaction/observabilidade).

---

## Sources

- Medusa v2 — Modules, Workflows (createStep/createWorkflow + compensação), Subscribers, Event Module, `defineLink`: Context7 `/medusajs/medusa` (docs oficiais, develop) — **HIGH**
- Medusa v2 — Payment module `getWebhookActionAndData`, `capturePayment`, `AbstractPaymentProvider`, rota built-in `POST /hooks/payment/{provider_id}`, Stripe async methods: Context7 `/medusajs/medusa` — **HIGH**
- Medusa v2 — Fulfillment module + `createFulfillmentWorkflow` em subscriber (`order.placed`): Context7 `/medusajs/medusa` — **HIGH**
- Projeto canônico — `docs/DB_MODEL_v1.21.md` (entidades custom, regras DATA-001..110, fronteira PaymentSession/PaymentAttempt, outbox AnalyticsEventLog, deduplication_key) — **HIGH (intent do projeto)**
- Projeto — `.planning/PROJECT.md`, `docs/seed/GSD_BACKEND_MVP_SEED.md` (invariantes 1–12, stack, escopo) — **HIGH**
- Integração Gelato (módulo custom, sem provider oficial Medusa); suporte específico a **Pix** no Stripe provider do Medusa — **MEDIUM** (validar na fase de pagamento)

---
*Architecture research for: backend POD e-commerce (Medusa v2, Brasil/BRL)*
*Researched: 2026-06-22*
