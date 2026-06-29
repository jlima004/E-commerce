---
phase: 04
artifact: research
status: awaiting_manual_review
generated_at: 2026-06-29T16:05:00-03:00
scope: research-only
phase_name: stripe-payments-payment-attempt
---

# Phase 04 — Stripe Payments & PaymentAttempt Research

## Escopo e Cercas

Esta pesquisa cobre apenas iniciação de pagamento Stripe por cartão e Pix em BRL, uso pré-Order de `PaymentCollection`/`PaymentSession`, modelagem de `PaymentAttempt`, segurança/PII, invalidação de tentativa por mutação de cart e estratégia de testes para PAY-01..PAY-04. [VERIFIED: 04-CONTEXT.md]

Esta pesquisa não cria plano, validação, migrations, schema runtime, config, secrets, webhook Stripe, Order, `WebhookEventLog`, `CheckoutCompletionLog`, `purchase_completed`, deploy ou integração Gelato. [VERIFIED: user request + 04-CONTEXT.md]

O resultado técnico principal é: **o caminho native-first é suficiente para ancorar `PaymentCollection`/`PaymentSession` e cartão Stripe, mas é apenas parcialmente suficiente para Pix; Pix precisa de gate manual/spike de implementação porque o provider Medusa instalado não possui service Pix explícito e pode persistir dados sensíveis do PaymentIntent se usado sem filtragem.** [VERIFIED: node_modules/@medusajs/payment-stripe@2.16.0 + Context7 /medusajs/medusa + docs.stripe.com]

## Fontes Lidas

- `.planning/phases/04-stripe-payments-payment-attempt/04-CONTEXT.md` — decisões D-01..D-47 e cerca canônica. [VERIFIED: local file]
- `.planning/phases/04-stripe-payments-payment-attempt/04-DISCUSSION-LOG.md` — trilha de auditoria, não fonte decisória. [VERIFIED: local file]
- `.planning/PROJECT.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md` — escopo Backend MVP, PAY-01..PAY-04 e gate manual. [VERIFIED: local files]
- `.planning/phases/03-cart-checkout-pre-order/03-CLOSURE.md`, `03-UAT.md`, `03-VALIDATION.md` — base Phase 03 pré-Order já aceita. [VERIFIED: local files]
- `docs/PRD_Backend_v1.1.md` §§4.1-4.3, 5.3-5.4, 8.1 — fluxo cartão/Pix e logs mínimos. [VERIFIED: local file]
- `docs/DB_MODEL_v1.21.md` §§2.18, 4.2, 4.3 e DATA-013..DATA-025 — fronteira `PaymentSession`/`PaymentAttempt`. [VERIFIED: local file]
- Código atual em `apps/backend/src/modules/checkout`, `apps/backend/src/api/store/carts`, `apps/backend/src/api/middlewares.ts`, `apps/backend/src/observability`. [VERIFIED: local code]
- Medusa docs via Context7 `/medusajs/medusa` e HTML oficial `docs.medusajs.com/resources/commerce-modules/payment/payment-checkout-flow`. [VERIFIED: Context7 /medusajs/medusa] [CITED: https://docs.medusajs.com/resources/commerce-modules/payment/payment-checkout-flow]
- Stripe Pix e PaymentIntent docs via Context7 `/websites/stripe`, Markdown oficial Stripe Pix, Stripe.js `confirmPixPayment`, PaymentIntent cancel e payment-method support. [VERIFIED: Context7 /websites/stripe] [CITED: https://docs.stripe.com/payments/pix/accept-a-payment.md?payment-ui=direct-api]
- Pacotes locais `@medusajs/payment-stripe@2.16.0` e `stripe` types no `node_modules` do monorepo. [VERIFIED: local node_modules]

## Project Constraints (from AGENTS.md)

- Responder em Português do Brasil. [VERIFIED: AGENTS.md]
- Backend MVP é Medusa v2 + Node.js + TypeScript, com PostgreSQL/Supabase + Redis. [VERIFIED: AGENTS.md]
- Pagamento é Stripe apenas, cartão e Pix; `Order` nunca pode ser criado antes do webhook confiável. [VERIFIED: AGENTS.md]
- Fulfillment é Gelato apenas, mas Gelato está fora desta Phase 04. [VERIFIED: AGENTS.md + 04-CONTEXT.md]
- Secrets, dados completos de cartão, tokens puros e dados sensíveis não podem aparecer em logs. [VERIFIED: AGENTS.md]
- Mercado é Brasil/BRL, single-currency, sem venda internacional. [VERIFIED: AGENTS.md]
- Antes de editar arquivos do repo, usar fluxo GSD; esta rodada é explicitamente research-only e autorizada pelo pedido do usuário a escrever apenas este artefato. [VERIFIED: AGENTS.md + user request]

## Decisões Canônicas Aplicadas

- D-01..D-04: iniciar pagamento exige `checkout_data_complete=true`, itens/shipping/email válidos e BR/BRL; `amount` e `currency` vêm do servidor, nunca do body. [VERIFIED: 04-CONTEXT.md]
- D-05..D-08: `PaymentCollection`/`PaymentSession` nativos são hipótese primary native-first, não decisão final de implementação. [VERIFIED: 04-CONTEXT.md]
- D-09..D-12: `PaymentSession` é camada Medusa/provedor; `PaymentAttempt` é trilha operacional customizada; `PaymentAttempt.order_id` fica `null`. [VERIFIED: 04-CONTEXT.md]
- D-13..D-19: no máximo uma tentativa ativa por cart; nova tentativa supersede/invalida a anterior; invalidação local é obrigatória mesmo se Stripe remoto seguir vivo. [VERIFIED: 04-CONTEXT.md]
- D-20..D-27: status canônicos pré-webhook não podem usar `paid`, `succeeded`, `captured` ou nomes que pareçam verdade financeira final. [VERIFIED: 04-CONTEXT.md]
- D-28..D-39: cartão nunca envia dado bruto ao backend; Pix é assíncrono, QR/instruções são resposta imediata, `expires_at` efetivo precisa ser persistido, e Pix pendente/expirado/cancelado/falho nunca cria `Order`. [VERIFIED: 04-CONTEXT.md]
- D-40..D-47: logs/Sentry precisam ser saneados; webhook, Order, `purchase_completed`, email e Gelato ficam para fases futuras. [VERIFIED: 04-CONTEXT.md]

## Pesquisa Medusa/Stripe

### Medusa PaymentCollection/PaymentSession

Medusa v2 modela o checkout de pagamento como `PaymentCollection` associada ao cart, seguida de `PaymentSession` dentro da collection para o provider escolhido; criar a sessão inicializa o provider externo. [VERIFIED: Context7 /medusajs/medusa] [CITED: https://docs.medusajs.com/resources/commerce-modules/payment/payment-checkout-flow]

O SDK Store `payment.initiatePaymentSession` cria/inicializa uma payment session e pode criar a collection se o cart ainda não tiver uma; isso é compatível com estado pré-Order desde que a Phase 04 não chame `completeCartWorkflow` nem `/store/carts/:id/complete`. [VERIFIED: Context7 /medusajs/medusa]

Completar o cart no fluxo Medusa é a etapa posterior que autoriza a sessão com o provider e lida com ações adicionais; essa etapa fica fora da Phase 04 porque o projeto exige `Order` apenas após webhook canônico. [VERIFIED: Context7 /medusajs/medusa + 04-CONTEXT.md]

### Provider Stripe Medusa v2.16.0

O workspace usa `@medusajs/medusa@2.16.0` e `@medusajs/framework@2.16.0` em `apps/backend/package.json`; o registry informou `@medusajs/medusa@2.17.1` como latest em 2026-06-29. [VERIFIED: local package.json] [CITED: npm view]

O provider local `@medusajs/payment-stripe@2.16.0` exporta services para `stripe`, `oxxo`, `bancontact`, `blik`, `giropay`, `ideal`, `przelewy24` e `promptpay`; ele não exporta service Pix explícito. [VERIFIED: node_modules/@medusajs/payment-stripe@2.16.0]

O service básico `StripeProviderService` define `paymentIntentOptions` vazio e herda de `StripeBase`, que cria PaymentIntent com `amount`, `currency`, `metadata.session_id` e parâmetros extras vindos de `data`. [VERIFIED: node_modules/@medusajs/payment-stripe@2.16.0]

`StripeBase.normalizePaymentIntentParameters` aceita `payment_method_types`, `payment_method_options`, `automatic_payment_methods`, `confirm`, `payment_method` e `return_url` via `data`, além da opção global `automaticPaymentMethods`. [VERIFIED: node_modules/@medusajs/payment-stripe@2.16.0]

O default do provider local usa `capture_method: "manual"` quando `options.capture` não é verdadeiro; isso é seguro para alguns fluxos de cartão, mas é risco para Pix porque Pix é um fluxo assíncrono de pagamento confirmado por QR e webhook, não uma autorização manual a capturar depois. [VERIFIED: node_modules/@medusajs/payment-stripe@2.16.0] [CITED: https://docs.stripe.com/payments/pix.md]

`StripeBase.getStatus` mapeia `requires_payment_method` com erro para `ERROR`, `requires_confirmation`/`processing` para `PENDING`, `requires_action` para `REQUIRES_MORE`, `canceled` para `CANCELED`, `requires_capture` para `AUTHORIZED` e `succeeded` para `CAPTURED`. [VERIFIED: node_modules/@medusajs/payment-stripe@2.16.0]

`StripeBase.getWebhookActionAndData` reconhece `payment_intent.processing`, `payment_intent.canceled`, `payment_intent.payment_failed`, `payment_intent.requires_action`, `payment_intent.amount_capturable_updated`, `payment_intent.partially_funded` e `payment_intent.succeeded` quando o PaymentIntent contém `metadata.session_id`; isso ajuda fases futuras, mas webhook continua fora da Phase 04. [VERIFIED: node_modules/@medusajs/payment-stripe@2.16.0 + 04-CONTEXT.md]

Risco crítico: `initiatePayment` retorna `...getStatus(sessionData)`, e `getStatus` devolve `data: paymentIntent`; o PaymentIntent da Stripe contém `client_secret` e pode conter `next_action`. O planner deve verificar se Medusa persiste esse `data` em `PaymentSession`; se persistir sem filtragem, o native-first puro viola a exigência desta Phase 04 de `client_secret` apenas em resposta imediata e nunca persistido/logado. [VERIFIED: node_modules/@medusajs/payment-stripe@2.16.0 + stripe types + 04-CONTEXT.md]

### Stripe Pix

Stripe Pix aceita pagamentos únicos em BRL para clientes no Brasil e usa QR code ou copia-e-cola Pix. [CITED: https://docs.stripe.com/payments/pix.md]

No fluxo direto, o servidor cria um PaymentIntent em `brl`, recomenda métodos dinâmicos/`automatic_payment_methods`, e envia ao cliente apenas o `client_secret` para concluir o pagamento. [CITED: https://docs.stripe.com/payments/pix/accept-a-payment.md?payment-ui=direct-api]

`stripe.confirmPixPayment(clientSecret, data?, options?)` confirma o PaymentIntent no cliente; com `handleActions:false`, o cliente pode exibir manualmente `next_action.pix_display_qr_code.data`, `image_url_svg`, `image_url_png`, `hosted_instructions_url` e `expires_at`. [CITED: https://docs.stripe.com/js/payment_intents/confirm_pix_payment]

Stripe informa que Pix de teste pode gerar `payment_intent.succeeded` ou `payment_intent.payment_failed` em cenários de sucesso/expiração, e que Pix pendente expira por `expires_at`/`expires_after_seconds`. [CITED: https://docs.stripe.com/payments/pix/accept-a-payment.md?payment-ui=direct-api]

Stripe recomenda confiar no evento `payment_intent.payment_failed` para verificar expiração efetiva quando houver divergência no timestamp prático; portanto a Phase 04 pode marcar UX local como `pix_expired`, mas a verdade financeira final continua reservada ao webhook da Phase 05/06. [CITED: https://docs.stripe.com/payments/pix/accept-a-payment.md?payment-ui=direct-api] [VERIFIED: 04-CONTEXT.md]

Stripe documenta que é possível cancelar Pix antes do vencimento cancelando o PaymentIntent associado, mas o cancelamento de PaymentIntent só é aceito em statuses canceláveis. [CITED: https://docs.stripe.com/payments/pix/accept-a-payment.md?payment-ui=direct-api] [CITED: https://docs.stripe.com/api/payment_intents/cancel.md]

## Avaliação Native-first

| Área | Avaliação | Confiança | Evidência |
|---|---|---:|---|
| Cartão Stripe BRL via Medusa Basic Stripe | Suficiente para iniciação se o plano derivar amount/currency server-side, usar `PaymentCollection`/`PaymentSession`, retornar `client_secret` apenas imediatamente e impedir complete cart. | MEDIUM-HIGH | [VERIFIED: node_modules/@medusajs/payment-stripe@2.16.0] [CITED: https://docs.medusajs.com/resources/commerce-modules/payment/payment-checkout-flow] |
| Pix Stripe assíncrono via Stripe API | Suficiente na Stripe: PaymentIntent BRL, `confirmPixPayment`, QR/copia-e-cola, `expires_at`, succeeded/failed por webhook e cancelamento antes do vencimento. | HIGH | [CITED: https://docs.stripe.com/payments/pix/accept-a-payment.md?payment-ui=direct-api] |
| Pix via provider Stripe Medusa sem customização | Parcialmente suficiente: o provider básico permite passar `automatic_payment_methods`/`payment_method_options.pix` via `data`, mas não há service Pix explícito, não há contrato Medusa documentado para QR/`expires_at` Pix, e `data: paymentIntent` pode persistir `client_secret`. | MEDIUM | [VERIFIED: node_modules/@medusajs/payment-stripe@2.16.0] |
| Webhook nativo Medusa | Útil para status de provider em fase futura, mas fora da Phase 04 e insuficiente como única decisão porque o projeto exige `WebhookEventLog`/raw-body/idempotência própria nas Phases 05/06. | HIGH | [VERIFIED: node_modules/@medusajs/payment-stripe@2.16.0 + 04-CONTEXT.md] |
| Native-first puro | **Parcialmente suficiente, não suficiente como decisão final para Pix.** | MEDIUM-HIGH | [VERIFIED: local provider + Context7 + Stripe docs] |

## Alternativas

| Alternativa | Quando usar | Trade-off |
|---|---|---|
| Provider Stripe nativo Medusa básico | Use como base para cartão e para preservar `PaymentCollection`/`PaymentSession` quando a persistência de `client_secret` puder ser filtrada/evitada e Pix puder ser configurado com `automatic_payment_methods`/`payment_method_options.pix`. [VERIFIED: node_modules/@medusajs/payment-stripe@2.16.0] | Menos código custom, mas risco de persistir PaymentIntent completo e lacuna de UX Pix explícita. [VERIFIED: node_modules/@medusajs/payment-stripe@2.16.0] |
| Custom payment provider Medusa para Pix | Use se o provider nativo não permitir filtrar `client_secret`, configurar TTL Pix e expor QR/`expires_at` sem persistir dados sensíveis. [VERIFIED: 04-CONTEXT.md + Stripe docs] | Mais código e manutenção, mas mantém contrato Medusa e controla retorno/persistência. [ASSUMED] |
| Camada própria Stripe para Pix/cartão preservando PaymentCollection/PaymentSession quando possível | Use se o contrato Store/UX precisar de refetch seguro de QR e controle fino de `PaymentAttempt`, mas Medusa provider não expuser isso sem vazamento. [VERIFIED: Stripe docs + 04-CONTEXT.md] | Pode duplicar parte da lógica do provider e exige cuidado para não quebrar Payment Module. [ASSUMED] |
| Camada própria Stripe somente para Pix e Medusa native para cartão | Use se cartão nativo for aceito e Pix for o único gap real. [VERIFIED: local provider lacks explicit Pix service] | Divide caminhos operacionais; exige correlação uniforme em `PaymentAttempt`. [ASSUMED] |

## Modelo PaymentAttempt

Campos mínimos recomendados para pesquisa/planning: `id`, `cart_id`, `payment_collection_id`, `payment_session_id`, `provider`, `provider_payment_intent_id`, `provider_payment_session_id`, `payment_method_type`, `status`, `amount`, `currency_code`, `expires_at`, `order_id`, `metadata`, `created_at`, `updated_at`, `client_confirmed_at`, `instructions_displayed_at`, `awaiting_webhook_since`, `superseded_at`, `invalidated_at`, `canceled_at`, `failed_at`, `expired_at`. [VERIFIED: 04-CONTEXT.md + docs/DB_MODEL_v1.21.md]

`order_id` deve ser `null` em toda a Phase 04 e só pode ser preenchido em fase futura de webhook + criação transacional de Order. [VERIFIED: 04-CONTEXT.md + docs/DB_MODEL_v1.21.md]

Status comuns canônicos da Phase 04: `created`, `provider_session_created`, `client_action_required`, `awaiting_webhook_confirmation`, `payment_failed`, `payment_canceled`, `superseded`, `invalidated_by_cart_change`. [VERIFIED: 04-CONTEXT.md]

Status locais adicionais de cartão: `card_client_secret_created`, `payment_client_confirmed`. [VERIFIED: 04-CONTEXT.md]

Status locais adicionais de Pix: `payment_instructions_displayed`, `awaiting_pix_payment`, `pix_expired`. [VERIFIED: 04-CONTEXT.md]

`provider_payment_intent_id` deve ser único quando não nulo para permitir correlação futura com Stripe webhook e `CheckoutCompletionLog`. [VERIFIED: docs/DB_MODEL_v1.21.md]

O MVP deve manter no máximo uma tentativa ativa por cart; tentativa nova deve superseder/inativar tentativa ativa anterior e preservar histórico auditável. [VERIFIED: 04-CONTEXT.md]

`metadata` deve ser allowlist-only: IDs seguros, método, fonte de expiração, preview mascarado/hash quando necessário; nunca `client_secret`, QR completo, copia-e-cola completo, body Stripe bruto, CPF/CNPJ cru ou endereço completo. [VERIFIED: 04-CONTEXT.md + apps/backend/src/observability/sanitize.ts]

## Segurança/PII

`client_secret` só pode aparecer na resposta imediata necessária ao cliente e não deve ser persistido em `PaymentAttempt`, logs, Sentry ou erros. [VERIFIED: 04-CONTEXT.md]

Se Medusa persistir `PaymentSession.data` com PaymentIntent completo, o plano precisa filtrar, criptografar, evitar essa persistência ou adotar customização; não é aceitável tratar `PaymentSession.data.client_secret` persistido como detalhe benigno. [VERIFIED: node_modules/@medusajs/payment-stripe@2.16.0 + 04-CONTEXT.md]

QR/copia-e-cola Pix não deve ser persistido integralmente salvo necessidade comprovada; Stripe permite exibição imediata via `next_action.pix_display_qr_code` e também fornece `hosted_instructions_url`. [VERIFIED: 04-CONTEXT.md] [CITED: https://docs.stripe.com/payments/pix/accept-a-payment.md?payment-ui=direct-api]

O código atual já redige padrões `sk_`, `whsec_`, bearer/JWT, assinatura Stripe, PAN, DSN, `pix_` e `pi_`, e descarta chaves `body`, `headers`, `cookies`, `authorization`, `query`, `raw_body`, `payload`, `email`, `phone`, `cpf`, `ip`. [VERIFIED: apps/backend/src/observability/sanitize.ts]

O allowlist atual aceita `cart_id`, `payment_intent_id` e `payment_attempt_id`; para Phase 04, o planner deve confirmar que novos campos operacionais usam somente IDs seguros e que mensagens de erro não incluem payload Stripe. [VERIFIED: apps/backend/src/observability/sanitize.ts + 04-CONTEXT.md]

`amount` e `currency` devem ser derivados do cart no servidor; qualquer body de cliente contendo `amount`, `currency`, `currency_code` ou override de total deve ser ignorado/rejeitado no contrato de iniciação. [VERIFIED: 04-CONTEXT.md]

## Invalidação por Mutação de Cart

Mutações de items, quantidades, shipping address ou email após tentativa ativa devem marcar a tentativa como `invalidated_by_cart_change` ou `superseded`; a tentativa antiga não pode avançar para Order em fases futuras mesmo se Stripe remoto depois emitir evento. [VERIFIED: 04-CONTEXT.md]

O cart já possui `checkout_data_complete` derivado e `calculateCheckoutDataComplete` recalcula BRL, região BR, itens, email e shipping address a cada resposta; Phase 04 deve consumir esse gate e não persistir readiness nominal. [VERIFIED: apps/backend/src/modules/checkout/checkout-data.ts + apps/backend/src/api/store/carts/serializers.ts]

O cancelamento remoto deve ser tentado apenas se houver `provider_payment_intent_id` e status Stripe cancelável; falha de cancelamento remoto não pode impedir a invalidação local obrigatória. [CITED: https://docs.stripe.com/api/payment_intents/cancel.md] [VERIFIED: 04-CONTEXT.md]

Para Pix, Stripe documenta cancelamento antes do vencimento por cancelamento do PaymentIntent associado; ainda assim, o backend deve persistir o `expires_at` efetivo/local e tratar expiração financeira final por webhook futuro. [CITED: https://docs.stripe.com/payments/pix/accept-a-payment.md?payment-ui=direct-api]

## Estratégia de Testes

Framework detectado: Jest 29.7.0 com `@medusajs/test-utils@2.16.0`; scripts existentes incluem `test:unit` e `test:integration:http`. [VERIFIED: apps/backend/package.json + apps/backend/jest.config.js]

Matriz unitária inicial:
- eligibility/gate: recusa cart sem `checkout_data_complete`, sem itens, sem shipping/email válidos, fora de BR/BRL. [VERIFIED: 04-CONTEXT.md + apps/backend/src/modules/checkout/checkout-data.ts]
- `PaymentAttempt` state machine: status canônicos, uma ativa por cart, supersede, `invalidated_by_cart_change`, `order_id=null`. [VERIFIED: 04-CONTEXT.md]
- sanitização: `client_secret`, `pi_*_secret_*`, QR/copia-e-cola, CPF/CNPJ cru e endereço completo não aparecem em logs/Sentry/erros. [VERIFIED: 04-CONTEXT.md + apps/backend/src/observability/sanitize.ts]
- amount/currency: body com valores monetários é rejeitado/ignorado e totais vêm do cart server-side. [VERIFIED: 04-CONTEXT.md]

Matriz integration HTTP inicial:
- iniciar cartão em cart completo retorna payload imediato suficiente para cliente e não retorna `Order`. [VERIFIED: 04-CONTEXT.md]
- iniciar Pix em cart completo retorna QR/instruções imediatas ou URL/instruções seguras, `expires_at`, status local pré-webhook e não retorna `Order`. [VERIFIED: 04-CONTEXT.md + Stripe docs]
- retry/supersede cria nova tentativa ativa e marca a anterior como histórica. [VERIFIED: 04-CONTEXT.md]
- mutação de email/shipping/items invalida tentativa ativa antes de nova tentativa. [VERIFIED: 04-CONTEXT.md]
- respostas públicas não incluem `client_secret` fora da resposta imediata e nunca incluem QR completo persistido. [VERIFIED: 04-CONTEXT.md]

Provas negativas obrigatórias:
- nenhum `Order`, nenhum `/store/carts/:id/complete`, nenhum `completeCartWorkflow`, nenhum webhook runtime, nenhum `WebhookEventLog`, nenhum `CheckoutCompletionLog`, nenhum `purchase_completed`, nenhum Gelato. [VERIFIED: user request + 04-CONTEXT.md]
- Pix `awaiting_pix_payment`, `pix_expired`, `payment_failed` e `payment_canceled` nunca cria `Order`. [VERIFIED: 04-CONTEXT.md + docs/DB_MODEL_v1.21.md]
- `client_secret` não é persistido/logado; se Medusa `PaymentSession.data` persistir PaymentIntent completo, o plano deve tratar isso como blocker. [VERIFIED: node_modules/@medusajs/payment-stripe@2.16.0 + 04-CONTEXT.md]
- `amount`/`currency` vindos do body nunca são aceitos como fonte de verdade. [VERIFIED: 04-CONTEXT.md]

Comandos existentes úteis para o planner:

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/checkout/__tests__/checkout-data.unit.spec.ts
cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/cart-checkout-store.spec.ts
cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build
```

Esses comandos são herdados da Phase 03; a Phase 04 deve adicionar testes próprios antes de execução, não reutilizar somente a matriz antiga. [VERIFIED: .planning/phases/03-cart-checkout-pre-order/03-VALIDATION.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| Gate de checkout/payment eligibility | API / Backend | Database / Storage | O servidor deriva `checkout_data_complete`, amount e currency do cart atual. [VERIFIED: 04-CONTEXT.md] |
| `PaymentCollection`/`PaymentSession` | API / Backend | Stripe | Medusa cria a collection/session e inicializa o provider externo. [VERIFIED: Context7 /medusajs/medusa] |
| `PaymentAttempt` | API / Backend | Database / Storage | Entidade operacional customizada para auditar tentativas e correlacionar webhook futuro. [VERIFIED: docs/DB_MODEL_v1.21.md] |
| QR/instruções Pix imediatas | API / Backend | Browser / Client, Stripe | Backend inicia sessão; cliente usa `client_secret`/Stripe.js para confirmar/exibir Pix. [CITED: https://docs.stripe.com/payments/pix/accept-a-payment.md?payment-ui=direct-api] |
| Verdade financeira final | API / Backend | Stripe webhook | Fora da Phase 04; pertence às Phases 05/06. [VERIFIED: 04-CONTEXT.md] |

## Don’t Hand-Roll

| Problema | Não construir | Usar/Preservar | Por quê |
|---|---|---|---|
| Coleta de cartão | Form próprio que envia PAN ao backend | Stripe.js/PaymentIntent/Medusa provider | Backend não pode processar dados brutos de cartão. [VERIFIED: 04-CONTEXT.md] |
| Fonte de total monetário | `amount`/`currency` no body | Cart server-side + Medusa totals | Evita manipulação de preço/currency. [VERIFIED: 04-CONTEXT.md] |
| Verdade financeira Pix | Status client-side ou retorno `confirmPixPayment` | Webhook Stripe canônico futuro | Pix é assíncrono e expiração/sucesso final vêm de evento. [CITED: https://docs.stripe.com/payments/pix/accept-a-payment.md?payment-ui=direct-api] |
| Logs de pagamento | Logger ad hoc com body/payload | `sanitizeContext`, `sanitizeError`, Sentry scrub atual | Política allowlist/redaction já existe. [VERIFIED: apps/backend/src/observability/sanitize.ts] |

## Common Pitfalls

### Persistir `client_secret` indiretamente

O provider Medusa local devolve o PaymentIntent inteiro como `data` da sessão, e PaymentIntent contém `client_secret`; se esse `data` for persistido sem filtragem, a Phase 04 viola D-22/D-30 mesmo sem gravar `client_secret` em `PaymentAttempt`. [VERIFIED: node_modules/@medusajs/payment-stripe@2.16.0 + stripe types + 04-CONTEXT.md]

### Tratar Pix como cartão síncrono

Pix deve ficar em `awaiting_pix_payment`/`awaiting_webhook_confirmation` até webhook futuro; QR exibido, retorno client-side ou redirect não são confirmação financeira final. [VERIFIED: 04-CONTEXT.md] [CITED: https://docs.stripe.com/payments/pix/accept-a-payment.md?payment-ui=direct-api]

### Usar complete cart cedo demais

Medusa documenta `Complete Cart` como etapa que autoriza a payment session e coloca pedido; o projeto proíbe esse caminho na Phase 04 porque Order só nasce após webhook canônico. [CITED: https://docs.medusajs.com/resources/commerce-modules/payment/payment-checkout-flow] [VERIFIED: 04-CONTEXT.md]

### Confundir `PaymentSession` com `PaymentAttempt`

`PaymentSession` pode ser substituída/controlada pelo Medusa/provedor; `PaymentAttempt` preserva a trilha operacional de domínio por cart, método, PaymentIntent e UX assíncrona. [VERIFIED: docs/DB_MODEL_v1.21.md]

### Cancelamento remoto como garantia principal

Stripe só cancela PaymentIntent em status cancelável; a invalidação local deve ser o controle obrigatório para impedir Order futuro de tentativa stale. [CITED: https://docs.stripe.com/api/payment_intents/cancel.md] [VERIFIED: 04-CONTEXT.md]

## Package Legitimacy Audit

Esta pesquisa não recomenda instalar pacote novo na Phase 04; os pacotes abaixo foram auditados porque são o stack de pagamento analisado. [VERIFIED: user request + package audit]

| Package | Registry | Version observed | Source Repo | Verdict | Disposition |
|---|---|---:|---|---|---|
| `@medusajs/medusa` | npm | local 2.16.0; latest 2.17.1 | github.com/medusajs/medusa | SUS: too-new on latest | Não instalar/atualizar nesta research; se planner propuser upgrade, adicionar checkpoint humano. |
| `@medusajs/payment-stripe` | npm | local 2.16.0; latest 2.17.1 | github.com/medusajs/medusa | SUS: too-new on latest | Usar local 2.16.0 como evidência; upgrade só com checkpoint humano. |
| `stripe` | npm | latest 22.3.0; provider Medusa depende de `stripe^15.5.0` | github.com/stripe/stripe-node | SUS: too-new on latest | Não instalar SDK Stripe direto nesta research; se planner propuser camada própria, adicionar checkpoint humano/pin. |

Packages removed due to SLOP verdict: none. [VERIFIED: package-legitimacy check]

Packages flagged as suspicious SUS: `@medusajs/medusa`, `@medusajs/payment-stripe`, `stripe`, all due to too-new latest publish signal, not due to missing repo or postinstall. [VERIFIED: package-legitimacy check + npm view scripts.postinstall]

## Ambiente Disponível

| Dependency | Required By | Available | Version | Fallback |
|---|---|---:|---|---|
| Node.js | Medusa/Jest tooling | sim | v22.23.0 | — |
| npm | registry/version checks | sim | 10.9.8 | — |
| ripgrep | source audit | sim | 15.1.0 | — |
| root `node_modules` | local provider inspection | sim | contains `@medusajs/payment-stripe@2.16.0` | — |
| Context7 | external docs | sim | `/medusajs/medusa`, `/websites/stripe` | official curl docs |

Missing dependencies with no fallback: none for research. [VERIFIED: local probes]

Missing dependencies with fallback: Medusa docs Markdown endpoint did not return useful body for some pages; Context7 plus rendered HTML/curl official pages covered the needed claims. [VERIFIED: tool outputs]

## Security Domain

| ASVS Category | Applies | Standard Control |
|---|---:|---|
| V2 Authentication | yes | Customer/guest identity from Medusa auth/session; never trust customer/cart id from body. [VERIFIED: Phase 03 code + 04-CONTEXT.md] |
| V3 Session Management | yes | Guest active cart remains session-backed via `req.session.active_cart_id`; payment start must bind to active cart. [VERIFIED: Phase 03 code] |
| V4 Access Control | yes | Cart/payment attempt operations scoped to current actor/session. [VERIFIED: 04-CONTEXT.md] |
| V5 Input Validation | yes | Server-side cart totals/currency, BR/BRL gate, sanitized DTOs. [VERIFIED: 04-CONTEXT.md + Phase 03 code] |
| V6 Cryptography | yes | Do not store secrets/QR full payload; future tokens/webhooks use standard provider verification, not custom crypto. [VERIFIED: 04-CONTEXT.md] |
| V8 Data Protection | yes | Allowlist logs, Sentry scrub, no raw body/payment payload/CPF/CNPJ/client_secret. [VERIFIED: apps/backend/src/observability/sanitize.ts] |

Known threat patterns:

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Amount tampering in request body | Tampering | Derive amount/currency from cart server-side. [VERIFIED: 04-CONTEXT.md] |
| Client secret leakage | Information Disclosure | Return only immediate response; redact logs/Sentry; prevent persistence in `PaymentAttempt` and verify `PaymentSession.data`. [VERIFIED: 04-CONTEXT.md + local provider] |
| Stale Pix payment after cart mutation | Tampering / Repudiation | Local invalidation by cart mutation plus future webhook correlation rejects stale attempt. [VERIFIED: 04-CONTEXT.md] |
| Duplicate/stale attempts | Repudiation | One active `PaymentAttempt` per cart; historical attempts immutable/auditable. [VERIFIED: 04-CONTEXT.md] |
| Premature Order/Gelato | Elevation of Privilege / Tampering | Phase 04 negative tests forbid Order, webhook, `purchase_completed`, Gelato. [VERIFIED: 04-CONTEXT.md] |

## Riscos/Abertos

1. **`PaymentSession.data` pode persistir PaymentIntent completo.**
   - O que sabemos: provider Medusa local retorna PaymentIntent completo em `data`. [VERIFIED: node_modules/@medusajs/payment-stripe@2.16.0]
   - O que falta: confirmar no runtime Medusa se essa `data` é persistida integralmente na tabela/registro de session. [ASSUMED]
   - Recomendação: planner deve colocar gate/spike antes de aceitar native-first puro para Phase 04. [VERIFIED: 04-CONTEXT.md]

2. **Pix não aparece como provider service explícito em `@medusajs/payment-stripe@2.16.0`.**
   - O que sabemos: services exportados não incluem Pix; basic Stripe permite parâmetros extras. [VERIFIED: node_modules/@medusajs/payment-stripe@2.16.0]
   - O que falta: testar se `provider_id=pp_stripe_stripe` com `automatic_payment_methods` ou `payment_method_types:["pix"]` entrega QR/`expires_at` sem vazamento. [ASSUMED]
   - Recomendação: não travar implementação final sem prova local ou customização. [VERIFIED: 04-CONTEXT.md]

3. **TTL Pix preferido de 30 minutos conflita com defaults Stripe documentados.**
   - O que sabemos: contexto prefere 30 minutos; Stripe docs de direct API descrevem default de 4h e aceitam `expires_after_seconds`/`expires_at`, enquanto types do SDK local indicam defaults diferentes em versão de types; o valor efetivo do provider deve vencer. [VERIFIED: 04-CONTEXT.md] [CITED: https://docs.stripe.com/payments/pix/accept-a-payment.md?payment-ui=direct-api] [VERIFIED: local stripe types]
   - Recomendação: persistir sempre o `expires_at` efetivo retornado e tratar webhook `payment_failed` como confirmação de expiração. [VERIFIED: 04-CONTEXT.md + Stripe docs]

4. **Configurar captura.**
   - O que sabemos: provider Medusa defaulta manual capture quando `capture` não é true. [VERIFIED: node_modules/@medusajs/payment-stripe@2.16.0]
   - O que falta: decisão final sobre estratégia de captura para cartão vs Pix sem violar Order pós-webhook. [ASSUMED]
   - Recomendação: planejar explicitamente `capture_method`/`capture` por método e testar Pix. [VERIFIED: local provider]

## Níveis de Confiança

| Tema | Nível | Motivo |
|---|---:|---|
| Medusa `PaymentCollection`/`PaymentSession` pré-Order | HIGH | Confirmado em docs oficiais/Context7 e coerente com PRD/DB model. [VERIFIED: Context7 /medusajs/medusa + local docs] |
| Cartão Stripe BRL com provider básico | MEDIUM-HIGH | Provider cria PaymentIntent com amount/currency; Stripe cards suportam PaymentIntents; falta execução real e decisão de captura. [VERIFIED: local provider] |
| Stripe Pix assíncrono | HIGH | Stripe docs oficiais cobrem BRL, QR/copia-e-cola, `confirmPixPayment`, `expires_at`, webhooks de sucesso/falha e cancelamento. [CITED: https://docs.stripe.com/payments/pix/accept-a-payment.md?payment-ui=direct-api] |
| Pix via Medusa native puro | MEDIUM | Provider básico aceita parâmetros extras, mas não há service Pix explícito nem evidência de contrato seguro de QR/`expires_at`/não persistência de `client_secret`. [VERIFIED: node_modules/@medusajs/payment-stripe@2.16.0] |
| Necessidade de custom provider/camada própria | MEDIUM | Há risco real, mas a decisão depende de spike sobre persistência de `PaymentSession.data` e retorno Pix no runtime Medusa. [VERIFIED: local provider + 04-CONTEXT.md] |
| Segurança/logs | HIGH | Sanitização allowlist já existe e cobre vários padrões Stripe/Pix; Phase 04 precisa ampliar testes para `client_secret` e QR. [VERIFIED: apps/backend/src/observability/sanitize.ts] |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | Um custom provider Medusa aumenta manutenção, mas dá controle fino de persistência/UX Pix. | Alternativas | Planner pode superestimar ou subestimar custo de customização. |
| A2 | Camada própria Stripe pode duplicar lógica do provider e exigir cuidado para não quebrar Payment Module. | Alternativas | Plano pode escolher arquitetura híbrida sem cobrir acoplamento com Medusa. |
| A3 | `PaymentSession.data` pode ser persistida integralmente pelo runtime Medusa. | Riscos/Abertos | Se for verdade e não for mitigado, há vazamento de `client_secret`; se for falso, customização pode ser desnecessária. |
| A4 | Testar `pp_stripe_stripe` com Pix via `automatic_payment_methods`/`payment_method_types:["pix"]` é necessário para decidir native-first. | Riscos/Abertos | Sem o spike, plano pode escolher caminho Pix que falha em produção. |
| A5 | Estratégia final de captura para cartão/Pix ainda precisa decisão. | Riscos/Abertos | Config errada pode impedir Pix ou criar fluxo financeiro incompatível. |

## Gate Manual

Research completo e aguardando revisão manual. [VERIFIED: user request]

Antes de qualquer `04-PLAN.md`, o humano/planner deve decidir se a Phase 04 fará um spike/gate sobre `PaymentSession.data` e Pix nativo ou se já exigirá custom provider/camada própria; esta pesquisa não escolhe implementação final para Pix porque a evidência nativa é parcial. [VERIFIED: 04-CONTEXT.md + local provider inspection]

Não iniciar execução, migrations, schema, runtime code, webhook, Order, deploy, config/secrets, `purchase_completed` ou Gelato a partir deste arquivo. [VERIFIED: user request + 04-CONTEXT.md]

## Sources

### Primary

- `.planning/phases/04-stripe-payments-payment-attempt/04-CONTEXT.md` — decisões D-01..D-47. [VERIFIED: local file]
- `node_modules/@medusajs/payment-stripe@2.16.0` — services exportados, criação/cancelamento/retrieve de PaymentIntent, status mapping e webhook action mapping. [VERIFIED: local node_modules]
- `docs/PRD_Backend_v1.1.md` e `docs/DB_MODEL_v1.21.md` — contrato produto/dados para PaymentSession/PaymentAttempt e Order pós-webhook. [VERIFIED: local files]
- `apps/backend/src/observability/sanitize.ts`, `logger.ts`, `sentry-scrub.ts`, `api/middlewares.ts` — redaction/logging/Sentry existentes. [VERIFIED: local code]

### External

- Context7 `/medusajs/medusa` — payment checkout flow, initiate payment session, Stripe provider config/webhook route. [VERIFIED: Context7 /medusajs/medusa]
- Context7 `/websites/stripe` — Pix PaymentIntent, `confirmPixPayment`, QR/`expires_at`, cancellation. [VERIFIED: Context7 /websites/stripe]
- Stripe Pix direct API docs. [CITED: https://docs.stripe.com/payments/pix/accept-a-payment.md?payment-ui=direct-api]
- Stripe.js `confirmPixPayment` docs. [CITED: https://docs.stripe.com/js/payment_intents/confirm_pix_payment]
- Stripe PaymentIntent cancel docs. [CITED: https://docs.stripe.com/api/payment_intents/cancel.md]
- Stripe Pix overview and payment method support docs. [CITED: https://docs.stripe.com/payments/pix.md] [CITED: https://docs.stripe.com/payments/payment-methods/payment-method-support.md]

## Metadata

Confidence breakdown:

- Standard stack: MEDIUM-HIGH — project stack and local provider versions are verified, but latest registry packages were flagged SUS due too-new. [VERIFIED: local package.json + package-legitimacy check]
- Architecture: HIGH — phase boundary and DB model are explicit and consistent. [VERIFIED: 04-CONTEXT.md + docs/DB_MODEL_v1.21.md]
- Pix native coverage: MEDIUM — Stripe API is clear, Medusa native provider coverage is partial. [VERIFIED: Stripe docs + local provider]
- Security pitfalls: HIGH — local provider and sanitizer make the `client_secret`/logging risks concrete. [VERIFIED: local provider + local code]

Research date: 2026-06-29. [VERIFIED: current_date]

Valid until: 2026-07-06 for Stripe/Medusa provider details because both registries changed within the current week. [VERIFIED: npm view]
