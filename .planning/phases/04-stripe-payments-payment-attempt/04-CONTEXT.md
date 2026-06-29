# Phase 4: Stripe Payments & PaymentAttempt - Context

**Gathered:** 2026-06-29
**Status:** Ready for planning (manual-review gated)

<domain>
## Phase Boundary

Permitir iniciar pagamentos Stripe por cartão e Pix em BRL a partir de um checkout pré-Order já completo, mantendo todo o estado comercial antes do `Order` em `Cart`, `PaymentCollection`, `PaymentSession` e `PaymentAttempt`. Esta fase cobre a iniciação do pagamento, o registro auditável de cada tentativa e a modelagem local de UX/estado assíncrono do Pix, sem tratar qualquer confirmação financeira final como verdade canônica.

**No escopo desta fase:**
- Iniciar pagamento por cartão via Stripe em BRL.
- Iniciar pagamento por Pix via Stripe em BRL.
- Criar/manter `PaymentCollection`/`PaymentSession` pré-Order no caminho escolhido pela fase.
- Registrar cada tentativa em `PaymentAttempt`.
- Expor ao cliente apenas os dados imediatos necessários para continuar o fluxo de pagamento, sem persistir secrets.
- Modelar Pix como assíncrono, com `expires_at` efetivo e estados locais pré-webhook.

**Fora do escopo (explícito):**
- Criar `Order`.
- Implementar webhook Stripe.
- Confirmar financeiramente pagamento com base em resposta do cliente.
- Emitir `purchase_completed`.
- Enviar email de confirmação.
- Iniciar fulfillment Gelato.
- Fazer deploy, configurar Stripe em ambiente, criar secrets/config vars, alterar schema/migrations ou executar a Phase 04.

</domain>

<decisions>
## Implementation Decisions

### Gating para iniciar pagamento
- **D-01:** Iniciar pagamento exige `checkout_data_complete = true`; Phase 04 não pode introduzir um caminho que bypassa a fronteira derivada da Phase 03.
- **D-02:** Iniciar pagamento exige cart com itens válidos, shipping/email válidos e contexto Brasil/BRL coerente com o contrato pré-Order já estabelecido.
- **D-03:** `amount` e `currency` devem ser sempre derivados server-side a partir do cart atual; o body do cliente nunca define `amount` ou `currency`.
- **D-04:** O cart permanece em estado pré-`Order` durante toda a Phase 04; nenhuma resposta de iniciação de pagamento pode insinuar que o checkout foi concluído financeiramente.

### Caminho principal de integração Stripe
- **D-05:** A Phase 04 parte de `PaymentCollection`/`PaymentSession` nativos do Medusa como hipótese primária de integração (`native-first`).
- **D-06:** Essa hipótese não fica travada no CONTEXT como decisão de implementação; a pesquisa da fase deve validar se o provider Stripe do Medusa v2 cobre adequadamente cartão em BRL, Pix assíncrono, QR/instruções, expiração, estados pendente/falho/cancelado e correlação segura com a tentativa local.
- **D-07:** Se a pesquisa mostrar que o provider nativo não cobre Pix assíncrono com segurança suficiente, o plano deve avaliar custom provider ou camada própria de integração Stripe.
- **D-08:** Nenhuma decisão de implementação concreta sobre provider, override ou customização própria deve ser tomada nesta etapa de CONTEXT.

### Fronteira entre `PaymentSession` e `PaymentAttempt`
- **D-09:** `PaymentSession` e `PaymentAttempt` não são equivalentes: a primeira pertence à camada Medusa/provedor; a segunda é a trilha operacional customizada da loja.
- **D-10:** `PaymentAttempt` concentra correlação com `cart_id`, `payment_collection_id`, `payment_session_id`, `provider_payment_intent_id`, amount/currency efetivos, estado operacional local e futura correlação com webhook/`CheckoutCompletionLog`.
- **D-11:** Estados de UX e confirmação do cliente pertencem a `PaymentAttempt`; eles não podem ser tratados como verdade financeira canônica.
- **D-12:** `PaymentAttempt.order_id` deve permanecer `null` nesta fase e continuar assim até as fases futuras de webhook + criação de `Order`.

### Regra operacional de tentativa por cart
- **D-13:** Existe no máximo uma `PaymentAttempt` ativa por cart no MVP.
- **D-14:** Nova tentativa supersede/invalida localmente a tentativa ativa anterior; tentativas históricas permanecem auditáveis.
- **D-15:** Não existe merge de tentativas nem reutilização de tentativa antiga quando o cart mudou.
- **D-16:** Se itens, quantidades, shipping address ou email mudarem depois da tentativa, a tentativa anterior deve ser marcada como `superseded` ou `invalidated_by_cart_change`.
- **D-17:** Uma nova tentativa após mudança no cart deve recalcular `amount`/`currency` exclusivamente a partir do cart atual no servidor.
- **D-18:** Tentativa invalidada por mudança de cart não pode avançar para `Order` em fases futuras, mesmo que uma sessão remota Stripe siga existindo até expirar.
- **D-19:** Se já existir sessão remota Stripe, a pesquisa/plano deve decidir se cancelamento/expiração remotos são possíveis e desejáveis; a invalidação local continua obrigatória independentemente disso.

### Contrato canônico de `PaymentAttempt`
- **D-20:** Campos mínimos esperados para o contexto da fase: `id`, `cart_id`, `payment_collection_id`, `payment_session_id`, `provider`, `provider_payment_intent_id`, `payment_method_type`, `status`, `amount`, `currency_code`, `expires_at`, `order_id`, `metadata` saneado, `created_at`, `updated_at`, timestamps operacionais relevantes e campos opcionais de confirmação do cliente.
- **D-21:** Persistir apenas identificadores seguros e metadados saneados, incluindo `provider`, `provider_payment_intent_id`, `provider_payment_session_id` quando houver, `cart_id`, `amount`, `currency`, `status`, `expires_at` e metadados operacionais não sensíveis.
- **D-22:** `client_secret` nunca deve ser persistido em `PaymentAttempt`.
- **D-23:** O conjunto canônico inicial de status comuns inclui `created`, `provider_session_created`, `client_action_required`, `awaiting_webhook_confirmation`, `payment_failed`, `payment_canceled`, `superseded` e `invalidated_by_cart_change`.
- **D-24:** Para cartão, o contexto trava adicionalmente `card_client_secret_created` e `payment_client_confirmed` como estados locais válidos.
- **D-25:** Para Pix, o contexto trava adicionalmente `payment_instructions_displayed`, `awaiting_pix_payment` e `pix_expired` como estados locais válidos.
- **D-26:** A nomenclatura da Phase 04 não deve usar `paid`, `succeeded`, `captured`, `confirmed_payment` ou qualquer rótulo que pareça verdade financeira final antes do webhook canônico.
- **D-27:** `payment_client_confirmed` significa apenas que o cliente concluiu/submeteu o fluxo client/provider; não significa pagamento confirmado financeiramente.

### Cartão
- **D-28:** O backend nunca recebe dados brutos de cartão; a fase deve usar Stripe/Medusa `PaymentSession` ou caminho equivalente confirmado na pesquisa.
- **D-29:** O backend pode retornar `client_secret` ao cliente quando necessário para o fluxo de cartão, mas somente na resposta imediata da rota de iniciação/continuação de pagamento.
- **D-30:** `client_secret` deve ser tratado como dado sensível: não logar, não enviar para Sentry, não persistir em `PaymentAttempt` e não incluir em erros.
- **D-31:** A pesquisa/plano deve decidir a ordem operacional mais segura entre criar a tentativa local e criar/associar a sessão remota Stripe, sem violar a trilha auditável por cart.

### Pix
- **D-32:** Pix deve ser modelado como fluxo assíncrono: QR/copia-e-cola exibidos ao cliente, tentativa local aguardando pagamento, e nenhuma confirmação financeira final antes do webhook Stripe.
- **D-33:** O backend pode retornar QR/instruções Pix ao cliente na resposta imediata de criação da tentativa.
- **D-34:** Persistir parcialmente os dados de Pix: `provider_payment_intent_id`/`provider_session_id`, `expires_at`, status local, amount/currency, método `pix` e opcionalmente hash ou preview mascarado da instrução se isso ajudar auditoria.
- **D-35:** Não persistir integralmente QR code, payload copia-e-cola ou instruções completas, salvo se a pesquisa demonstrar necessidade real para UX/reexibição e segurança adequada.
- **D-36:** Para reexibição do Pix, a pesquisa deve avaliar se o backend pode refetch/derivar as instruções da sessão Stripe sem armazenar o payload integralmente.
- **D-37:** A preferência de contexto para TTL Pix é 30 minutos; se Stripe/Medusa impuser outro TTL ou retornar `expires_at` próprio, o valor efetivo do provider é a fonte de verdade.
- **D-38:** O backend deve sempre persistir o `expires_at` efetivo retornado/configurado.
- **D-39:** Pix pendente, expirado, cancelado ou falho nunca pode criar `Order`.

### Segurança, logs e observabilidade
- **D-40:** Não logar `client_secret`, tokens Stripe, raw payment data, CPF/CNPJ cru, endereço completo ou payloads sensíveis de pagamento.
- **D-41:** A fase deve reaproveitar a política allowlist/redaction/sanitização já estabelecida na Phase 01 para logs, erros e Sentry.
- **D-42:** Erros de pagamento retornados ao cliente e registrados internamente devem permanecer saneados; nenhum secret ou config var pode aparecer em docs, logs ou telemetria.
- **D-43:** Se a fase registrar eventos operacionais de iniciação de pagamento, eles devem usar apenas identificadores seguros (`cart_id`, `payment_collection_id`, `payment_session_id`, `provider_payment_intent_id`, `payment_method_type`, `confirmation_state`, `timeout_status`) e nunca segredos.

### Fronteira com fases futuras
- **D-44:** A confirmação financeira canônica pertence às Phases 05/06 via webhook Stripe validado; a Phase 04 não pode antecipar essa responsabilidade.
- **D-45:** A Phase 05 cuidará de raw-body, assinatura Stripe e `WebhookEventLog`.
- **D-46:** A Phase 06 cuidará da criação idempotente de `Order` acionada apenas pelo webhook canônico aprovado.
- **D-47:** `purchase_completed`, e-mail e Gelato continuam reservados para as fases 07+.

### the agent's Discretion
- A pesquisa e o planejamento podem decidir os nomes exatos de rotas, handlers, DTOs, services, módulos e shape de resposta, desde que preservem integralmente a fronteira pré-Order e as decisões D-01..D-47.
- A pesquisa/plano também podem refinar quais timestamps e campos auxiliares entram em `PaymentAttempt`, desde que mantenham auditabilidade por cart, não persistam segredos e respeitem a distinção entre estado local/UX e verdade financeira canônica.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Escopo, roadmap e requisitos
- `.planning/PROJECT.md` — limites do backend MVP, BRL-only, Stripe card + Pix e decisão global de que o estado pré-pagamento vive em `Cart`, `PaymentCollection`, `PaymentSession` e `PaymentAttempt`.
- `.planning/ROADMAP.md` §"Phase 4: Stripe Payments & PaymentAttempt" — objetivo, dependência da Phase 03 e critérios de sucesso da fase.
- `.planning/REQUIREMENTS.md` — `PAY-01`, `PAY-02`, `PAY-03`, `PAY-04`.
- `.planning/STATE.md` — manual-review gate e posição atual: Phase 04 em planning only, não iniciada.

### Fechamento e decisões herdadas da Phase 03
- `.planning/phases/03-cart-checkout-pre-order/03-CONTEXT.md` — contrato pré-Order, `checkout_data_complete` derivado, BR/BRL e fronteiras que Phase 04 deve reaproveitar.
- `.planning/phases/03-cart-checkout-pre-order/03-CLOSURE.md` — Phase 03 fechada, com boundary explícita de não introduzir `Order`, pagamento, webhook ou Gelato.
- `.planning/phases/03-cart-checkout-pre-order/03-UAT.md` — evidências automatizadas do contrato pré-Order que Phase 04 parte como base.
- `.planning/phases/03-cart-checkout-pre-order/03-VALIDATION.md` — provas negativas e limites da camada de checkout anterior.
- `.planning/phases/03-cart-checkout-pre-order/03-01-SUMMARY.md` — contrato de cart ativo e omissão explícita de campos de payment/order.
- `.planning/phases/03-cart-checkout-pre-order/03-02-SUMMARY.md` — attach seguro do cart da sessão atual e regra de um cart ativo por ator.
- `.planning/phases/03-cart-checkout-pre-order/03-03-SUMMARY.md` — validação BR/PII-safe de email/endereço.
- `.planning/phases/03-cart-checkout-pre-order/03-04-SUMMARY.md` — `checkout_data_complete` derivado, sem `ready_for_payment`.
- `.planning/phases/03-cart-checkout-pre-order/03-05-SUMMARY.md` — provas negativas finais pré-Order e ausência de Stripe/Pix/webhook na fase anterior.

### Documentos canônicos de produto e banco
- `docs/PRD_Backend_v1.1.md` §4.1-4.3 — fluxos críticos de checkout com cartão/Pix, manutenção do estado pré-pagamento e ausência de `Order` antes do webhook aprovado.
- `docs/PRD_Backend_v1.1.md` §5.3-5.4 — requisitos `BE-CH-006`, `BE-CH-007`, `BE-CH-010` e `BE-PG-*` para Payment Collection/Session e pagamentos Stripe.
- `docs/PRD_Backend_v1.1.md` §8.1 — logs mínimos obrigatórios de criação de `PaymentCollection`/`PaymentSession`, criação de pagamento e retorno aguardando confirmação.
- `docs/DB_MODEL_v1.21.md` §2.18 — fronteira canônica entre `PaymentSession` e `PaymentAttempt`.
- `docs/DB_MODEL_v1.21.md` §4.3 — finalidade, campos mínimos e regras de `PaymentAttempt`.
- `docs/DB_MODEL_v1.21.md` §4.2 — camada lógica de `PaymentSession` e metadados mínimos do provedor.
- `docs/DB_MODEL_v1.21.md` `DATA-013`, `DATA-014`, `DATA-015`, `DATA-021`, `DATA-022`, `DATA-023`, `DATA-024`, `DATA-025` — invariantes de pré-Order, Pix assíncrono, idempotência e correlação de tentativas.

### Arquitetura, stack e riscos
- `.planning/research/STACK.md` — Medusa v2, Stripe provider, BRL/Pix, Redis workflow engine e nota de risco sobre cobertura do provider Stripe para Pix assíncrono.
- `.planning/research/ARCHITECTURE.md` — ordenação rígida entre checkout, webhook, `Order`, analytics e fulfillment.
- `.planning/research/PITFALLS.md` — anti-patterns ligados a money path, especialmente criação antecipada de `Order` e acoplamento incorreto entre checkout e verdade financeira.

### Decisões anteriores relevantes
- `.planning/phases/02-catalog-media/02-CONTEXT.md` — reutilização da fronteira de variantes vendáveis/publicáveis e do contexto BRL.
- `.planning/phases/01-foundation-observability/01-CONTEXT.md` — redaction, allowlist logging, Sentry saneado e regra de não expor segredos/payloads sensíveis.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/backend/src/modules/checkout/active-cart.ts` — já protege o shape pré-Order do cart e falha quando campos proibidos de payment/order aparecem cedo demais.
- `apps/backend/src/modules/checkout/checkout-data.ts` — centraliza o cálculo de `checkout_data_complete` e os gates BR/BRL que devem ser reaproveitados antes de iniciar pagamento.
- `apps/backend/src/api/store/carts/serializers.ts` — já modela a resposta pública pré-Order e é um ponto natural para acrescentar, ou deliberadamente não acrescentar, superfícies de estado de pagamento conforme o plano decidir.
- `apps/backend/src/api/store/carts/query-config.ts` — padrão atual para query-config mínima da Store API.
- `apps/backend/src/api/middlewares.ts` — ponto consolidado para wiring de middlewares, query configs, auth opcional e response shaping.
- `apps/backend/src/observability/sanitize.ts` e testes relacionados — base já existente para redaction de Stripe/Pix e negação de dados sensíveis em logs/Sentry.

### Established Patterns
- A codebase já privilegia extensão mínima da Store API padrão em vez de rotas paralelas desnecessárias.
- A fronteira pré-Order é ativamente protegida por testes e helpers; a Phase 04 deve avançar o money path sem romper essa barreira.
- `checkout_data_complete` continua derivado; Phase 04 deve consumi-lo como gate, não convertê-lo em status persistido.
- Logging/erros seguem allowlist e sanitização central; qualquer surface de pagamento precisa herdar esse padrão.

### Integration Points
- `apps/backend/src/api/store/carts` e rotas relacionadas — superfície provável para iniciar/continuar pagamento e consultar estado operacional pré-Order.
- `apps/backend/src/modules/checkout` — local natural para helpers puros de eligibility, invalidação de tentativa e correlação com o cart atual.
- Camadas Medusa de `PaymentCollection`/`PaymentSession` — ponto de integração a ser validado em research como hipótese primária.
- Futuro acoplamento com webhook/`CheckoutCompletionLog` — deve ser antecipado apenas no contrato de correlação, sem implementação nesta fase.

</code_context>

<specifics>
## Specific Ideas

- A preferência operacional é `native-first`, mas apenas como hipótese de pesquisa: downstream agents devem validar se o provider Stripe do Medusa v2 realmente cobre cartão BRL e Pix assíncrono com segurança suficiente.
- `PaymentAttempt` precisa ser pensada como trilha operacional/auditável do checkout, não como verdade financeira.
- Em especial para Pix, a fase deve otimizar para reexibição segura e auditoria mínima, evitando persistir payload integral quando um refetch/derive seguro da sessão Stripe puder resolver.
- A invalidação local por mudança de cart é obrigatória mesmo que a sessão remota Stripe ainda exista e expire sozinha depois.

</specifics>

<deferred>
## Deferred Ideas

- Decisão final sobre usar provider Stripe nativo sem customização, custom provider ou camada própria — somente após research.
- Decisão final sobre cancelamento/expiração remotos de sessão Stripe superseded/invalidated — somente após research/planning.
- Implementação de webhook Stripe com raw-body e assinatura — Phase 05.
- Criação idempotente de `Order` por `payment_intent_id`/`cart_id + payment_intent_id` — Phase 06.
- `purchase_completed`, email de confirmação e Gelato — Phases 07+.

</deferred>

---

*Phase: 4-Stripe Payments & PaymentAttempt*
*Context gathered: 2026-06-29*
