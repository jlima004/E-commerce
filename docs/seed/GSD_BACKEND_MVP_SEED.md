# GSD Backend MVP Seed — E-commerce POD de Camisetas

## Produto

E-commerce headless Print-on-Demand de camisetas para o Brasil.

## Escopo ativo

Desenvolver apenas o backend MVP.

O frontend será desenvolvido depois, mas o backend deve preparar contratos de API para futura storefront.

## Stack

- Medusa v2
- Node.js
- TypeScript
- PostgreSQL/Supabase
- Supabase Storage
- Redis
- Stripe
- Resend
- Gelato
- Sentry
- PostHog
- VPS Linux
- PM2 ou equivalente
- Nginx ou equivalente

## Documentos canônicos

- SRS v1.5
- PRD Backend v1.1
- DB_MODEL v1.21
- PRD Frontend v1.1 apenas como contrato futuro de consumo

## Must-have do backend

- Setup Medusa v2
- Admin em subdomínio próprio
- PostgreSQL/Supabase
- Redis
- Produtos, variantes, preços BRL
- Metadados Gelato obrigatórios
- Supabase Storage para imagens
- Carrinho
- Checkout convidado e autenticado
- Stripe cartão e Pix
- Payment Collection / Payment Session
- PaymentAttempt customizado
- Webhook Stripe validado e idempotente
- Order criado somente após webhook Stripe canônico aprovado
- CheckoutCompletionLog para idempotência de criação de Order
- WebhookEventLog para eventos Stripe/Gelato
- AnalyticsEventLog como outbox local
- purchase_completed registrado duravelmente pelo backend
- Fulfillment Gelato apenas após Order + purchase_completed local durável
- Resend para e-mail de confirmação antes da tentativa Gelato
- Gelato fulfillment module
- Gelato webhook
- Tracking
- TrackingAccessToken seguro para convidados
- Reembolso via Admin confirmado por webhook Stripe
- Trocas operacionais no Admin
- Correios manual/semiautomático
- OperationalAlert
- EmailDeliveryLog
- AdminActionLog
- Sentry backend
- Logs estruturados
- Health check
- Testes críticos

## Fora do escopo

- Frontend
- Editor visual de camiseta
- Upload de arte pelo cliente
- Estoque físico
- Produção própria
- Multi-fornecedor POD
- Multi-moeda
- Venda internacional
- Métodos de pagamento além de cartão e Pix
- Integração automática com API dos Correios
- Automação completa de troca pelo cliente
- ERP
- Marketplace

## Invariantes de arquitetura

1. Order não deve existir antes da confirmação confiável do pagamento por webhook Stripe.
2. Pix pendente, expirado, cancelado ou falho não cria Order.
3. Webhook Stripe deve ser validado, persistido e idempotente.
4. A criação de Order deve ser idempotente por payment_intent_id ou cart_id + payment_intent_id.
5. purchase_completed é evento de domínio backend/outbox, não evento frontend.
6. Fulfillment Gelato depende de Order confirmado + purchase_completed registrado localmente.
7. Fulfillment Gelato não depende de AnalyticsEventLog.status = sent nem do sucesso do PostHog.
8. Um Order não pode gerar mais de um pedido Gelato ativo, salvo reprocessamento manual controlado.
9. Reembolso local só atualiza estado financeiro após webhook Stripe confiável.
10. Reembolso não altera automaticamente order_status para canceled.
11. Tokens de tracking não podem ser armazenados em texto puro.
12. Secrets, dados completos de cartão e tokens puros não podem aparecer em logs.

## Resultado esperado do roadmap

Gerar roadmap backend em fases pequenas, verificáveis e compatíveis com Cursor.

Cada fase deve ter:
- contexto
- pesquisa
- plano
- spec/SDD
- tarefas executáveis
- critérios de aceite
- comandos de verificação
- fechamento