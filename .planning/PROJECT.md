# E-commerce POD de Camisetas — Backend MVP

## What This Is

Backend headless de um e-commerce Print-on-Demand (POD) de camisetas para o mercado brasileiro, construído sobre Medusa v2. Este escopo entrega **apenas o backend MVP**: catálogo, carrinho, checkout (convidado e autenticado), pagamento via Stripe (cartão e Pix), criação confiável de pedidos pós-webhook, fulfillment via Gelato, tracking, reembolsos/trocas operacionais pelo Admin e observabilidade. O frontend (storefront) virá depois — o backend deve expor contratos de API estáveis para consumo futuro.

## Core Value

Um pedido (Order) só existe e só é enviado à produção (Gelato) após confirmação de pagamento confiável, validada e idempotente pelo webhook canônico do Stripe — sem cobrança fantasma, sem pedido duplicado, sem fulfillment indevido.

## Business Context

- **Customer**: Consumidores brasileiros comprando camisetas POD; operadores internos usando o Admin para reembolsos, trocas e suporte.
- **Revenue model**: Venda direta de camisetas impressas sob demanda (sem estoque físico), produzidas e enviadas pela Gelato.
- **Success metric**: Taxa de pedidos pagos que resultam em fulfillment Gelato correto e único, com zero criação de Order sem pagamento confirmado.
- **Strategy notes**: Documentos canônicos — SRS v1.5, PRD Backend v1.1, DB_MODEL v1.21, PRD Frontend v1.1 (apenas como contrato futuro de consumo).

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. -->

- [x] Setup Medusa v2 com PostgreSQL/Supabase e Redis
- [x] Admin Medusa em subdomínio próprio
- [x] Catálogo: produtos, variantes e preços em BRL com metadados Gelato obrigatórios
- [x] Imagens de produto em Supabase Storage
- [x] Carrinho e checkout convidado e autenticado
- [x] Pagamento Stripe (cartão e Pix) via Payment Collection / Payment Session
- [x] PaymentAttempt customizado para rastrear tentativas de pagamento
- [x] Webhook Stripe validado, persistido e idempotente (WebhookEventLog)
- [x] Criação de Order somente após webhook Stripe canônico aprovado, idempotente (CheckoutCompletionLog)
- [x] purchase_completed registrado duravelmente pelo backend (AnalyticsEventLog como outbox local)
- [x] Fulfillment Gelato somente após Order confirmado + purchase_completed local durável
- [x] E-mail de confirmação via Resend antes da tentativa Gelato (EmailDeliveryLog)
- [x] Módulo de fulfillment Gelato + webhook Gelato + tracking
- [x] TrackingAccessToken seguro (nunca em texto puro) para acesso de convidados
- [x] Reembolso via Admin confirmado por webhook Stripe
- [x] Trocas operacionais no Admin e fluxo Correios manual/semiautomático
- [x] OperationalAlert persistido e consultável para falhas operacionais (OPS-01, Phase 12 complete/closed)
- [x] AdminActionLog para ações administrativas de dinheiro/pedido/fulfillment (OPS-02, Phase 12 complete/closed)
- [x] Observabilidade: Sentry backend, logs estruturados, health check
- [x] Testes críticos cobrindo invariantes de pagamento/Order/fulfillment (TEST-01, Phase 12 complete/closed)

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Frontend / storefront — entregue em milestone posterior; este escopo é só backend.
- Editor visual de camiseta e upload de arte pelo cliente — fora do MVP, complexidade de produto.
- Estoque físico e produção própria — modelo é POD via Gelato, sem inventário.
- Multi-fornecedor POD — apenas Gelato no MVP.
- Multi-moeda e venda internacional — MVP é Brasil/BRL apenas.
- Métodos de pagamento além de cartão e Pix — escopo de pagamento restrito.
- Integração automática com a API dos Correios — tratado manual/semiautomático no Admin.
- Automação completa de troca pelo cliente — trocas são operacionais via Admin.
- ERP e Marketplace — fora da visão do produto.

## Context

- **Stack alvo**: Medusa v2, Node.js, TypeScript, PostgreSQL/Supabase, Supabase Storage, Redis, Stripe, Resend, Gelato, Sentry, PostHog.
- **Infra**: VPS Linux com PM2 (ou equivalente) e Nginx (ou equivalente); Admin em subdomínio dedicado. **Checkpoint histórico (2026-06-26):** produção validada em Heroku app `espacoliminar`, com web/worker dynos, Supabase Postgres via pooler e Heroku Redis com TLS; a rota VPS/PM2/Nginx fica como blueprint portável. **Estado consolidado (2026-07-16):** CACHE-01A PASS, CACHE-01B PASS e INFRA-01 PASS; cache Redis ativo em `web.1` e `worker.1`; estabilização concluída e produção saudável.
- **Arquitetura**: headless — backend expõe contratos de API que o storefront futuro consumirá (PRD Frontend v1.1 é referência de contrato, não escopo de build).
- **Domínio**: e-commerce POD exige separação rígida entre confirmação de pagamento (Stripe) e disparo de produção (Gelato), com logs de outbox/idempotência para evitar cobrança fantasma, pedido duplicado e fulfillment indevido.
- **Analytics**: purchase_completed é um evento de domínio do backend (outbox durável), independente do sucesso do PostHog no frontend.

## Constraints

- **Tech stack**: Medusa v2 + Node.js + TypeScript — base obrigatória; integrações via módulos Medusa.
- **Persistência**: PostgreSQL/Supabase + Redis — fila/cache e estado transacional.
- **Pagamento**: Stripe apenas (cartão e Pix); Order nunca criado antes do webhook confiável.
- **Fulfillment**: Gelato apenas; um Order não pode gerar mais de um pedido Gelato ativo (salvo reprocessamento manual controlado).
- **Segurança**: tokens de tracking nunca em texto puro; secrets, dados completos de cartão e tokens puros nunca em logs.
- **Mercado**: Brasil/BRL, single-currency, sem venda internacional.
- **Compatibilidade**: contratos de API devem antecipar o consumo da storefront futura (PRD Frontend v1.1).

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Order criado somente após webhook Stripe canônico aprovado | Evitar cobrança fantasma e pedidos sem pagamento confirmado | — Pending |
| Idempotência de Order por payment_intent_id (ou cart_id + payment_intent_id) | Webhooks podem reentregar; criação deve ser à prova de duplicação | — Pending |
| purchase_completed como evento de domínio backend (outbox), não evento frontend | Garantir registro durável independente do PostHog | — Pending |
| Fulfillment Gelato depende de Order confirmado + purchase_completed local durável | Nunca produzir antes de pagamento e registro confiáveis | — Pending |
| Reembolso só atualiza estado financeiro após webhook Stripe confiável; não muda order_status para canceled automaticamente | Estado financeiro e estado de pedido são desacoplados | — Pending |
| Tokens de tracking armazenados com hash/criptografia, nunca em texto puro | Segurança de acesso de convidados | — Pending |
| Backend-only MVP com contratos de API para storefront futura | Frontend é milestone posterior | — Pending |
| PRD Backend v1.1 + DB_MODEL v1.21 sobrepõem a redação mais antiga da SRS que sugere Order/awaiting_payment antes do pagamento confirmado | Estado pré-pagamento vive em Cart, PaymentCollection, PaymentSession e PaymentAttempt; Order só existe após confirmação canônica do webhook Stripe | — Decided (must be honored by all future planning) |
| Heroku é o runtime de produção atual para o checkpoint da Fase 01 | A rota VPS/PM2/Nginx planejada foi substituída neste ciclo por Heroku/Supabase/Heroku Redis já estabilizados | — Decided (current production target) |
| Phase 12.1 selected as an inserted release-readiness and production-validation phase for the merged backend MVP | It adds no product feature and does not start the storefront milestone | — Decided (CONTEXT complete; awaiting human review) |

> **Decision (SRS wording override):** For implementation, PRD Backend v1.1 + DB_MODEL v1.21 override older SRS wording that suggests Order/awaiting_payment before confirmed payment. Pre-payment state lives in Cart, PaymentCollection, PaymentSession, and PaymentAttempt. Order exists only after canonical Stripe webhook payment confirmation. This decision must be visible to and honored by future planning agents.

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-24 during Phase 12.1 CONTEXT; PR 7 merged; Phase 12 remains closed; 45/45 requirements and 56/56 existing plans complete; milestone not archived; frontend not started*
