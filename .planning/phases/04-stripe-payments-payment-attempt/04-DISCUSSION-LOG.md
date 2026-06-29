# Phase 4: Stripe Payments & PaymentAttempt - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-29
**Phase:** 04-stripe-payments-payment-attempt
**Areas discussed:** caminho principal de integração, regra operacional de tentativa por cart, contrato canônico de PaymentAttempt

---

## Caminho principal de integração

| Option | Description | Selected |
|--------|-------------|----------|
| `A` | Travar desde já `PaymentCollection`/`PaymentSession` nativos do Medusa como caminho primário definitivo para cartão e Pix. | |
| `B` | Adotar preferência operacional `native-first`, mas deixar a pesquisa validar cobertura real do provider Stripe do Medusa v2 antes de travar implementação. | ✓ |
| `C` | Outro caminho definido fora das opções acima. | |

**User's choice:** `B`, com preferência operacional `native-first`.
**Notes:** O contexto deve registrar `PaymentCollection`/`PaymentSession` nativos como hipótese primária, mas sem travar decisão antes de research. A pesquisa precisa validar cartão BRL, Pix assíncrono, QR/instruções, expiração, estados pendente/falho/cancelado e correlação segura com tentativa local. Se o provider nativo não cobrir Pix assíncrono de forma segura, o plano deve avaliar custom provider ou camada própria Stripe.

---

## Regra operacional de tentativa por cart

| Option | Description | Selected |
|--------|-------------|----------|
| `A` | No máximo uma `PaymentAttempt` ativa por cart; nova tentativa supersede/invalida a anterior e histórico permanece auditável. | ✓ |
| `B` | Permitir múltiplas tentativas abertas coexistindo para o mesmo cart. | |
| `C` | Outro comportamento operacional. | |

**User's choice:** `A`.
**Notes:** No máximo uma tentativa ativa por cart. Nova tentativa supersede/invalida localmente a anterior. Não há merge de tentativas nem reutilização de tentativa antiga se o cart mudou. Mudança posterior no cart deve marcar a tentativa anterior como `superseded` ou `invalidated_by_cart_change`; a nova tentativa deve recalcular `amount`/`currency` server-side. Mesmo que a sessão remota Stripe continue existindo até expirar, a invalidação local é obrigatória e a tentativa antiga não pode avançar para `Order` em fases futuras.

---

## Contrato canônico de PaymentAttempt

| Option | Description | Selected |
|--------|-------------|----------|
| Status finalistas | Usar nomes como `paid`, `succeeded`, `captured` ou equivalentes já na Phase 04. | |
| Status pré-webhook | Usar apenas estados operacionais/UX que não se confundem com verdade financeira final. | ✓ |
| Persistência ampla | Persistir `client_secret`, QR completo e payloads completos de Pix. | |

**User's choice:** Status pré-webhook com persistência mínima e saneada.
**Notes:** Status comuns escolhidos: `created`, `provider_session_created`, `client_action_required`, `awaiting_webhook_confirmation`, `payment_failed`, `payment_canceled`, `superseded`, `invalidated_by_cart_change`. Para cartão: `card_client_secret_created`, `payment_client_confirmed`, `awaiting_webhook_confirmation`. Para Pix: `payment_instructions_displayed`, `awaiting_pix_payment`, `pix_expired`, `payment_failed`, `payment_canceled`. Não usar `paid`, `succeeded`, `captured`, `confirmed_payment` ou rótulos equivalentes na Phase 04. `payment_client_confirmed` significa apenas conclusão/submissão do fluxo no client/provider. O backend pode retornar `client_secret` na resposta imediata do fluxo de cartão, mas não pode logar, enviar ao Sentry, persistir em `PaymentAttempt` ou incluir em erro. Para Pix, o armazenamento deve ser parcial: persistir identificadores seguros, `expires_at`, método, amount/currency e status local; não persistir integralmente QR/copia-e-cola salvo necessidade comprovada em research. A preferência de contexto para TTL Pix é 30 minutos, mas o `expires_at` efetivo do provider é a fonte de verdade.

---

## Regras globais

**User's choice:** travar explicitamente a fronteira da fase.
**Notes:** `amount` e `currency` sempre derivados server-side do cart atual; body do cliente nunca define esses campos. Iniciar pagamento exige `checkout_data_complete=true`, cart BRL/Brasil, itens válidos e shipping/email válidos. Phase 04 não cria `Order`, não implementa webhook Stripe, não faz fulfillment Gelato, não emite `purchase_completed` e não trata resposta do cliente como verdade financeira final. Pix pending/expired/canceled/failed nunca cria `Order`.

---

## the agent's Discretion

- Nomes exatos de rotas, handlers, DTOs e shape final das respostas ficam para research/planning, desde que preservem as decisões acima.

## Deferred Ideas

- Validar em research se o provider Stripe do Medusa v2 cobre Pix assíncrono com segurança suficiente ou se será necessário custom provider/camada própria.
- Validar em research se sessões Stripe superseded/invalidated podem ou devem ser canceladas/expiradas remotamente.
