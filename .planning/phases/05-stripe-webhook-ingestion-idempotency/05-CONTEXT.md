# Phase 05: Stripe Webhook Ingestion & Idempotency - Context

**Gathered:** 2026-06-30
**Status:** Ready for planning (manual-review gated)
**Source:** Phase 05 planning cycle after Gate 04A

<domain>
## Phase Boundary

Receber webhooks Stripe com raw body preservado, validar assinatura, registrar/deduplicar eventos em `WebhookEventLog` e atualizar o estado local de `PaymentAttempt` para eventos de PaymentIntent. A Phase 05 confirma localmente o pagamento a partir do webhook Stripe canônico, mas ainda não cria `Order`.

**No escopo desta fase:**
- `POST /hooks/stripe` com `req.rawBody` preservado.
- Validação de `stripe-signature` com `stripe.webhooks.constructEvent(...)`.
- Configuração fail-closed de `STRIPE_WEBHOOK_SECRET` e flag operacional de ingestão.
- Módulo/entidade `WebhookEventLog` com deduplicação transacional.
- Processamento inicial de `payment_intent.succeeded`, `payment_intent.payment_failed` e `payment_intent.canceled`.
- Atualização de `PaymentAttempt` por `provider_payment_intent_id`.
- Eventos Stripe não suportados registrados como `ignored`, idempotentes e sem mutação de negócio.

**Fora do escopo explícito:**
- Criar `Order`.
- Chamar `completeCartWorkflow`, `createOrderWorkflow` ou `/store/carts/:id/complete`.
- Criar `CheckoutCompletionLog`.
- Emitir ou persistir `purchase_completed`.
- Chamar Gelato, criar fulfillment, enviar e-mail ou analytics outbox.
- Implementar refunds.
- Ativar Pix produção ou exigir segredo real em documentação.
- Persistir payload bruto Stripe, `client_secret`, `pi_*_secret`, Pix QR/copia-e-cola, hosted instructions URL, `Authorization`, cookies ou PII completa.

</domain>

<decisions>
## Implementation Decisions

### Endpoint e raw body
- **D-01:** A rota planejada é `POST /hooks/stripe`, alinhada ao roadmap e à arquitetura `api/hooks`.
- **D-02:** `apps/backend/src/api/middlewares.ts` deve configurar `bodyParser: { preserveRawBody: true }` para `matcher: "/hooks/stripe"` e `method: ["POST"]`.
- **D-03:** O handler deve usar `req.rawBody` como payload de assinatura. `req.body` parseado não é aceitável para `constructEvent`.
- **D-04:** Assinatura ausente, raw body ausente ou assinatura inválida deve retornar HTTP 400 antes de qualquer operação de banco.
- **D-05:** Nenhum CORS/auth de Store/Admin deve ser aplicado ao webhook Stripe; o controle de autenticidade é assinatura Stripe + secret de endpoint.

### Segurança de assinatura e config
- **D-06:** A validação deve usar `stripe.webhooks.constructEvent(rawBody, stripeSignature, STRIPE_WEBHOOK_SECRET)`.
- **D-07:** Não haverá fallback inseguro que aceite webhook sem assinatura válida.
- **D-08:** Em produção, `STRIPE_WEBHOOK_SECRET` é obrigatório quando a ingestão estiver habilitada; ausência deve falhar fechado.
- **D-09:** A flag planejada é `STRIPE_WEBHOOK_INGESTION_ENABLED`; quando falsa em ambiente não produtivo, a rota pode retornar 503 saneado sem processar. Em produção, o plano deve tratar ingestão desabilitada como erro de configuração ou fail-closed explícito.
- **D-10:** Logs devem ser allowlist-only: `provider`, `event_type`, `external_event_id`, `payment_intent_id`, `payment_attempt_id`, `status`, `correlation_id`.

### Idempotência
- **D-11:** `WebhookEventLog` é a primeira persistência após assinatura válida e antes de mutações permitidas em `PaymentAttempt`.
- **D-12:** A chave canônica de deduplicação é `provider + deduplication_key`.
- **D-13:** Para Stripe, `deduplication_key = external_event_id` quando `event.id` confiável existir.
- **D-14:** Se um evento Stripe vier sem `event.id`, o fallback documentado é `provider + payload_hash` normalizado ou chave determinística equivalente; essa exceção deve ser rara, testada e ainda passar por `deduplication_key`.
- **D-15:** `payload_hash` é diagnóstico e insumo de fallback; sozinho não é a constraint canônica.
- **D-16:** Evento duplicado deve retornar 200 sem nova mutação de negócio.

### Eventos suportados
- **D-17:** `payment_intent.succeeded` confirma localmente o `PaymentAttempt` por webhook canônico, validado e idempotente.
- **D-18:** `payment_intent.payment_failed` marca tentativa correlata como `payment_failed`, preservando `order_id = null`.
- **D-19:** `payment_intent.canceled` marca tentativa correlata como `payment_canceled`, preservando `order_id = null`.
- **D-20:** Eventos não suportados devem ser persistidos como `ignored`, idempotentes e sem atualização de `PaymentAttempt`.

### Correlação com PaymentAttempt
- **D-21:** A correlação primária é `PaymentAttempt.provider_payment_intent_id = payment_intent.id`.
- **D-22:** O handler deve validar `amount_received` ou `amount`, `currency`, `metadata.cart_id` quando presente e seguro, e o método de pagamento esperado (`card` ou `pix`) antes de atualizar a tentativa.
- **D-23:** Divergência de amount/currency deve marcar o webhook como `failed` saneado e não atualizar a tentativa para confirmado.
- **D-24:** PaymentIntent sem tentativa correlata deve ser registrado em `WebhookEventLog` como `failed` ou `deferred` conforme a implementação escolher; não deve crashar nem criar `Order`.
- **D-25:** Tentativa terminal (`superseded`, `invalidated_by_cart_change`, `payment_failed`, `payment_canceled`, `pix_expired`) não deve ser reativada por webhook tardio; o evento deve ser registrado como `ignored` ou `failed` saneado conforme o caso.
- **D-26:** Pix real smoke ainda estar bloqueado por elegibilidade da conta Stripe não bloqueia testes locais/mocks de webhook; não planejar ativação Pix produção nesta fase.

### State machine
- **D-27:** O estado novo planejado para sucesso é `payment_confirmed_by_webhook`.
- **D-28:** `payment_confirmed_by_webhook` significa apenas: Stripe webhook canônico validado confirmou o PaymentIntent e a tentativa local está pronta para Phase 06. Não significa `Order` criado.
- **D-29:** O estado novo deve entrar nos tipos/model/migration planejada de `PaymentAttempt` e permanecer com `order_id = null` na Phase 05.
- **D-30:** Transições permitidas para sucesso: `card_client_secret_created`, `payment_client_confirmed`, `awaiting_pix_payment` e `awaiting_webhook_confirmation` -> `payment_confirmed_by_webhook`.
- **D-31:** `payment_confirmed_by_webhook` deve bloquear nova tentativa ativa no cart até a Phase 06 consumir a confirmação; portanto ele deve ser tratado como estado ativo da trilha financeira, embora não tenha transições adicionais nesta fase.

### Transação e concorrência
- **D-32:** Processamento deve ser transacional: registrar/localizar log, obter dedup/lock por constraint única, atualizar `PaymentAttempt`, marcar log `processed`, `ignored` ou `failed`.
- **D-33:** Corridas de replay Stripe devem ser vencidas pelo banco via unique indexes, não por check-then-act em memória.
- **D-34:** O handler deve responder rápido após persistir/processar o mínimo da Phase 05; efeitos lentos ficam fora desta fase.

### Fronteira com Phase 06
- **D-35:** Phase 06 só pode criar `Order` a partir de `PaymentAttempt.status = payment_confirmed_by_webhook` originado de webhook Stripe assinado, persistido e idempotente.
- **D-36:** `WebhookEventLog` não substitui `CheckoutCompletionLog`; Phase 05 não deve criar o log de conclusão do checkout.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Escopo e estado
- `.planning/STATE.md` — Gate 04A completo, Phase 05 autorizada apenas para planning neste ciclo.
- `.planning/ROADMAP.md` §"Phase 5: Stripe Webhook Ingestion & Idempotency" — rota `/hooks/stripe`, raw body, assinatura e `WebhookEventLog`.
- `.planning/REQUIREMENTS.md` — `WHK-01`, `WHK-02`; `ORD-*` continuam pendentes para Phase 06.
- `.planning/phases/04A-stripe-real-layer-activation/04A-SUMMARY.md` — evidência de card smoke real, `PaymentAttempt` persistido e ausência de Order/webhook/completion/Gelato.

### Pagamento e tentativa local
- `.planning/phases/04-stripe-payments-payment-attempt/04-CONTEXT.md` — decisões D-44..D-47 delegando webhook/Order/outbox para fases futuras.
- `.planning/phases/04-stripe-payments-payment-attempt/04-RESEARCH.md` — safe Stripe boundary, Pix assíncrono e riscos de persistência sensível.
- `.planning/phases/04-stripe-payments-payment-attempt/04-VALIDATION.md` — provas negativas pre-Order e comandos de teste existentes.
- `apps/backend/src/modules/payment-attempt/types.ts` — estados atuais; falta o estado confirmado por webhook.
- `apps/backend/src/modules/payment-attempt/state-machine.ts` — transições atuais e metadados sensíveis proibidos.
- `apps/backend/src/modules/payment-attempt/models/payment-attempt.ts` — modelo atual e índices de PaymentAttempt.
- `apps/backend/src/modules/payment-attempt/migrations/Migration20260629000000.ts` — migration preparada, não aplicada, que precisará ser revisada se o status novo for adicionado.

### Produto e banco
- `docs/PRD_Backend_v1.1.md` §4.1-4.2 — Stripe webhook é o passo que valida pagamento antes de Order.
- `docs/DB_MODEL_v1.21.md` §§2.6, 4.5, 5.8 — `WebhookEventLog`, `deduplication_key`, fallback e status.
- `docs/DB_MODEL_v1.21.md` DATA-005, DATA-013..DATA-015, DATA-021, DATA-029..DATA-034 — invariantes de webhook, Order e PaymentAttempt.
- `.planning/research/ARCHITECTURE.md` — padrões raw-body `/hooks/stripe`, `WebhookEventLog`, e separação de `CheckoutCompletionLog`.
- `.planning/research/PITFALLS.md` — riscos de assinatura, dedup frágil, Pix assíncrono e eventos fora de ordem.

### Documentação de framework/API verificada neste ciclo
- Context7 `/medusajs/medusa` — Medusa v2 preserva raw body com `bodyParser: { preserveRawBody: true }` e expõe `req.rawBody`.
- Context7 `/stripe/stripe-node/v19.1.0` — `stripe.webhooks.constructEvent(...)` exige o corpo bruto e `stripe-signature`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/backend/src/api/middlewares.ts` já concentra middlewares e logging/correlation; deve receber a configuração raw-body específica para `/hooks/stripe`.
- `apps/backend/src/config/env.ts` já possui parsing fail-fast de env e padrão de flags booleanas; deve receber `STRIPE_WEBHOOK_SECRET` e `STRIPE_WEBHOOK_INGESTION_ENABLED`.
- `apps/backend/src/observability/sanitize.ts`, `logger.ts` e `sentry-scrub.ts` já fazem redaction e grouping saneado.
- `apps/backend/src/modules/payment-attempt/state-machine.ts` já centraliza transições e bloqueio de metadados sensíveis.
- `apps/backend/src/modules/payment-attempt/service.ts` já contém helpers puros e o módulo Medusa para `PaymentAttempt`.

### Gaps
- Não existe módulo `webhooks`.
- Não existe `WebhookEventLog`.
- Não existe rota `/hooks/stripe`.
- Não existe raw-body middleware para `/hooks/stripe`.
- Não existe `payment_confirmed_by_webhook` em `PaymentAttempt`.
- Não existe teste HTTP de assinatura Stripe válida/inválida.

</code_context>

<specifics>
## Specific Ideas

- Usar `provider = "stripe"` e `external_event_id = event.id`.
- Usar `deduplication_key = event.id` para Stripe quando presente; fallback `payload_hash:<sha256>` apenas quando `event.id` estiver ausente.
- Calcular `payload_hash` com SHA-256 de representação normalizada/saneada do evento verificado, não com raw body persistido.
- Persistir metadados allowlist: `stripe_payment_intent_id`, `payment_attempt_id`, `correlation_id`, `payment_method_type`, `amount`, `currency`.
- Guardar `failure_reason_sanitized` ou `error_code/error_message` saneados, sem payload bruto.
- Mapear `payment_intent.payment_failed` de Pix expirado para `payment_failed` nesta fase; `pix_expired` continua disponível para expiração local/UX, mas a verdade financeira do evento Stripe é falha/cancelamento.

</specifics>

<deferred>
## Deferred Ideas

- Criação de `Order`, `CheckoutCompletionLog` e atualização de `PaymentAttempt.order_id` — Phase 06.
- `purchase_completed`, PostHog/outbox e analytics — Phase 07.
- Resend confirmation e `EmailDeliveryLog` — Phase 08.
- Gelato fulfillment e webhook Gelato — Phase 09.
- Refund/refund webhooks — Phase 11.
- Ativação Pix produção ou coleta de segredo real — fora deste ciclo.

</deferred>

<scope_fence>
## Scope Fence

Este ciclo criou apenas planejamento. A execução futura da Phase 05 também deve parar antes de qualquer `Order`, `CheckoutCompletionLog`, `purchase_completed`, Gelato, e-mail, analytics outbox ou refund flow. Qualquer plano que proponha essas ações pertence à Phase 06+ e deve ser rejeitado.
</scope_fence>

---

*Phase: 05-stripe-webhook-ingestion-idempotency*
*Context gathered: 2026-06-30*
