---
phase: 05
artifact: research
status: planning_manual_gate
generated_at: 2026-06-30T00:00:00-03:00
scope: context-research-plan-only
phase_name: stripe-webhook-ingestion-idempotency
---

# Phase 05 — Stripe Webhook Ingestion & Idempotency Research

## Escopo e Cercas

Esta pesquisa cobre apenas a ingestão Stripe webhook com raw body, assinatura, deduplicação persistida e atualização local de `PaymentAttempt`. Ela não implementa endpoint, migration, model runtime ou testes; não cria `Order`, `CheckoutCompletionLog`, `purchase_completed`, Gelato, e-mail, analytics ou refund flow.

## Fontes Lidas

- `.planning/STATE.md` — Gate 04A completo e Phase 05 ainda não iniciada antes deste ciclo.
- `.planning/ROADMAP.md` — Phase 05 entrega `/hooks/stripe` + `WebhookEventLog` DB-level dedup.
- `.planning/REQUIREMENTS.md` — `WHK-01`, `WHK-02`; `ORD-*` ainda pendentes.
- `.planning/phases/04A-stripe-real-layer-activation/04A-SUMMARY.md` — smoke real card, `PaymentAttempt` seguro e ausência de webhook/Order.
- `.planning/phases/04-stripe-payments-payment-attempt/04-CONTEXT.md`, `04-RESEARCH.md`, `04-VALIDATION.md` — safe Stripe boundary, estados atuais e provas negativas.
- `docs/PRD_Backend_v1.1.md`, `docs/SRS_v1.5.md`, `docs/DB_MODEL_v1.21.md` — fluxos Stripe, eventos e entidades canônicas.
- `.planning/research/ARCHITECTURE.md`, `.planning/research/PITFALLS.md`, `.planning/research/STACK.md` — padrões e riscos de webhook/idempotência.
- `apps/backend/src/api/middlewares.ts`, `apps/backend/src/config/env.ts`, `apps/backend/src/modules/payment-attempt/*`, `apps/backend/package.json`.
- Context7 `/medusajs/medusa` — raw body em Medusa v2 via `bodyParser: { preserveRawBody: true }` e `req.rawBody`.
- Context7 `/stripe/stripe-node/v19.1.0` — `constructEvent(rawBody, stripe-signature, webhookSecret)` e exigência de corpo bruto.

## Achados Técnicos

### Medusa raw body

Medusa v2 permite preservar raw body por rota no `defineMiddlewares` com `bodyParser: { preserveRawBody: true }`. O handler lê `req.rawBody`. Para Stripe, isso deve ser específico de `/hooks/stripe`, porque verificar assinatura contra JSON parseado/re-serializado é inválido.

### Stripe signature verification

Stripe Node v19.1.0 expõe `stripe.webhooks.constructEvent(payload, header, secret, tolerance?, cryptoProvider?, receivedAt?)`. A documentação do SDK reforça que `payload` precisa ser o corpo bruto exatamente recebido. O header é `stripe-signature`. Falha de assinatura deve retornar 400 antes de DB.

### WebhookEventLog canônico

`docs/DB_MODEL_v1.21.md` define `WebhookEventLog` como registro técnico de eventos externos. Campos mínimos: `provider`, `external_event_id`, `event_type`, `entity_type`, `entity_id`, `payload_hash`, `deduplication_key`, `status`, `processing_attempts`, `error_code`, `error_message`, metadata allowlist e timestamps.

A constraint canônica é `unique(provider, deduplication_key)`. Para Stripe, a chave preferencial deriva de `event.id` (`evt_*`). `payload_hash` é diagnóstico e fallback quando não houver `external_event_id` confiável; ele não deve ser a única proteção fora da `deduplication_key`.

### PaymentAttempt atual

Estados atuais:

- Pré-processamento: `created`, `provider_session_created`, `client_action_required`, `card_client_secret_created`, `payment_client_confirmed`, `payment_instructions_displayed`, `awaiting_pix_payment`, `awaiting_webhook_confirmation`.
- Terminais/falha/local: `pix_expired`, `payment_failed`, `payment_canceled`, `superseded`, `invalidated_by_cart_change`.

Não há estado que represente sucesso confirmado por webhook. A Phase 05 deve adicionar `payment_confirmed_by_webhook`, mantendo `order_id = null` e sem rótulos proibidos (`paid`, `succeeded`, `captured`, `confirmed_payment`).

### Correlação e validação de PaymentIntent

A correlação deve usar `PaymentAttempt.provider_payment_intent_id = payment_intent.id`. Antes de atualizar a tentativa, validar:

- `payment_intent.id` existe.
- `amount_received` ou `amount` corresponde à tentativa.
- `currency` é `brl`.
- `metadata.cart_id`, quando presente, corresponde ao cart da tentativa.
- método de pagamento esperado é compatível com a tentativa (`card` ou `pix`).
- tentativa não está superseded/invalidated/fail/canceled/expired.

### Eventos suportados

- `payment_intent.succeeded`: atualizar a tentativa para `payment_confirmed_by_webhook`, gravar `processed`, sem `Order`.
- `payment_intent.payment_failed`: atualizar para `payment_failed`, gravar `processed`, sem `Order`.
- `payment_intent.canceled`: atualizar para `payment_canceled`, gravar `processed`, sem `Order`.
- Outros eventos: gravar `ignored`, sem mutação.

### Transação e concorrência

O desenho seguro é:

1. Assinatura válida.
2. Calcular `external_event_id`, `payload_hash`, `deduplication_key`.
3. Inserir/localizar `WebhookEventLog` em transação.
4. Se unique conflict já processado/ignored/failed, retornar 200 no-op.
5. Marcar `processing`.
6. Executar mutação permitida de `PaymentAttempt`.
7. Marcar `processed`, `ignored` ou `failed`.

A implementação deve usar unique constraint, transação/upsert ou captura de erro de unicidade, não check-then-act sem trava.

## Decisões Recomendadas

| Tema | Decisão |
|------|---------|
| Rota | `POST /hooks/stripe` |
| Raw body | `bodyParser: { preserveRawBody: true }` no matcher exato |
| Assinatura | `stripe.webhooks.constructEvent(req.rawBody, req.headers["stripe-signature"], env.STRIPE_WEBHOOK_SECRET)` |
| Secret | `STRIPE_WEBHOOK_SECRET`, obrigatório em produção quando ingestão está habilitada |
| Flag | `STRIPE_WEBHOOK_INGESTION_ENABLED`, default conservador definido no plano de env |
| Dedup | `unique(provider, deduplication_key)`; Stripe usa `event.id` |
| Fallback | `deduplication_key = payload_hash:<sha256>` somente se `event.id` ausente |
| Sucesso local | `PaymentAttempt.status = payment_confirmed_by_webhook` |
| Phase 06 | só consome tentativas `payment_confirmed_by_webhook` |

## Riscos

1. **Raw body mal configurado:** assinatura válida falha ou assinatura inválida passa se handler usar JSON parseado. Mitigação: teste HTTP com assinatura válida/inválida e assert de uso de `req.rawBody`.
2. **Dedup frágil:** usar apenas `payload_hash` pode quebrar com redelivery semanticamente igual, mas byte/payload diferente. Mitigação: `event.id` como chave Stripe e unique `provider + deduplication_key`.
3. **Webhook tardio em tentativa inválida:** tentativa antiga pode receber `succeeded`. Mitigação: não reativar `superseded`/`invalidated_by_cart_change`; registrar evento como `ignored`/`failed` saneado.
4. **Amount/currency divergente:** evento forjado ou tentativa stale. Mitigação: marcar log `failed`, não confirmar tentativa.
5. **Confirmação local confundida com Order:** `payment_confirmed_by_webhook` deve manter `order_id = null`; negative grep/test impede `Order`, `CheckoutCompletionLog` e `purchase_completed`.
6. **Pix real smoke bloqueado:** não depender de conta Stripe Pix real para aceitar Phase 05; usar fixtures e Stripe CLI em smoke futuro com card/test-mode.

## Estratégia de Testes Recomendada

Unitários:
- derivação de `deduplication_key`.
- `payload_hash` normalizado sem secrets.
- transições `payment_confirmed_by_webhook`, `payment_failed`, `payment_canceled`.
- validação de amount/currency/cart/method.
- tentativa terminal não reativa.
- sanitização de erro e metadata.

Integração HTTP:
- assinatura válida retorna 200 e persiste log.
- assinatura ausente/inválida retorna 400 e não toca DB.
- evento duplicado retorna 200 com uma linha/mutação.
- `payment_intent.succeeded` confirma tentativa, sem Order.
- `payment_intent.payment_failed` falha tentativa, sem Order.
- `payment_intent.canceled` cancela tentativa, sem Order.
- evento ignorado é `ignored`, sem mutação.
- tentativa inexistente é registrada sem crash.
- amount/currency divergente não confirma.
- replay concorrente gera uma linha e uma atualização.
- greps negativos para `completeCartWorkflow`, `createOrderWorkflow`, `CheckoutCompletionLog`, `purchase_completed`, Gelato e segredos persistidos.

## Stripe CLI Smoke Futuro

Não executar neste ciclo. Na execução futura, o smoke deve:

1. Criar uma tentativa real card via Gate 04A/card route para obter `provider_payment_intent_id`.
2. Rodar `stripe listen --forward-to localhost:9001/hooks/stripe` com secret de CLI em env local, sem colar segredo no chat ou docs.
3. Usar evento real que corresponda ao PaymentIntent da tentativa, ou fixture assinada com `stripe.webhooks.generateTestHeaderString` nos testes.
4. Provar que a tentativa vai para `payment_confirmed_by_webhook`, `order_id` segue `null`, e nenhum `CheckoutCompletionLog`/`Order`/`purchase_completed`/Gelato aparece.

## Resultado

A Phase 05 deve ser planejada em fatias manuais com um gate inicial de schema/config, seguida por endpoint/assinatura, processamento de PaymentIntent e validação final. Execução fica bloqueada até aprovação humana.
