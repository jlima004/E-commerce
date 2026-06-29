---
phase: 04-stripe-payments-payment-attempt
plan: 01
subsystem: payments
tags: [stripe, medusa, payment-session, pix, client_secret, gate, spike]

requires:
  - phase: 03-cart-checkout-pre-order
    provides: checkout_data_complete gate, cart Store API pré-Order
provides:
  - Decisão de gate native-first vs custom provider/camada própria
  - Prova estática stripe-provider-gate.unit.spec.ts
  - Flags vinculantes para 04-04/04-05
affects: [04-02, 04-03, 04-04, 04-05, 04-06]

tech-stack:
  added: []
  patterns:
    - "Gate estático via leitura de node_modules/@medusajs/payment-stripe@2.16.0 e @medusajs/payment@2.16.0"

key-files:
  created:
    - apps/backend/src/modules/payment-attempt/__tests__/stripe-provider-gate.unit.spec.ts
  modified: []

key-decisions:
  - "Native-first puro bloqueado: Medusa persiste PaymentIntent integral (incl. client_secret) em PaymentSession.data"
  - "Pix exige custom provider ou camada própria — provider básico não tem service Pix nem filtragem de QR/secret"
  - "04-04 e 04-05 não podem executar até replanejamento com mitigação de persistência"

patterns-established:
  - "Spike/gate estático: inspecionar provider + payment-module sem rede/Stripe/secrets"

requirements_addressed: [PAY-01, PAY-02, PAY-03, PAY-04]
requirements-completed: []

duration: 25min
completed: 2026-06-29
status: complete
---

# Phase 04 Plan 01 — Stripe Provider Gate Summary

**Spike/gate estático confirma que `@medusajs/payment-stripe@2.16.0` persiste PaymentIntent integral em `PaymentSession.data`, bloqueando native-first puro para cartão e Pix.**

## Gate Flags (decisão vinculante)

```
NATIVE_CARD_SAFE=false
PIX_NATIVE_SAFE=false
CUSTOM_PROVIDER_OR_LAYER_REQUIRED=true
PAYMENTSESSION_SECRET_PERSISTENCE_BLOCKER=true
MIGRATION_REQUIRED_FOR_PAYMENTATTEMPT=true
FUTURE_STRIPE_CONFIG_REQUIRED=true
BLOCK_NATIVE_IF_SECRET_PERSISTED=true
```

**Parada manual:** com `PAYMENTSESSION_SECRET_PERSISTENCE_BLOCKER=true` e `CUSTOM_PROVIDER_OR_LAYER_REQUIRED=true`, **não executar 04-04 nem 04-05** até replanejamento explícito da estratégia de provider/camada de filtragem.

---

## Perguntas do gate — respostas com evidência

### 1. `PaymentSession.data` persiste o PaymentIntent completo?

| Pergunta | Resposta | Evidência |
|----------|----------|-----------|
| PaymentSession.data persists full PaymentIntent? | **Sim** | Medusa `createPaymentSession` faz `data: { ...input.data, ...providerPaymentSession.data }` e `updatePaymentSession` grava `providerData.data` integralmente. Model `PaymentSession` usa `data: model.json()` sem sanitização. |

**Cadeia observada (local, sem rede):**

1. `StripeBase.initiatePayment` → retorna `{ id, ...getStatus(sessionData) }`.
2. `StripeBase.getStatus` → **todos** os branches retornam `{ status, data: paymentIntent }` (PaymentIntent Stripe integral).
3. `PaymentModuleService.createPaymentSession` (L161-165) → persiste merge em `paymentSessionService_.update({ data: { ...input.data, ...providerPaymentSession.data } })`.
4. `PaymentSession` model → coluna JSON `data` default `{}`, sem hook de redaction.

**Arquivos inspecionados:** `node_modules/@medusajs/payment-stripe@2.16.0/dist/core/stripe-base.js`, `node_modules/@medusajs/payment@2.16.0/dist/services/payment-module.js`, `node_modules/@medusajs/payment@2.16.0/dist/models/payment-session.js`.

---

### 2. `client_secret` pode vazar por `PaymentSession.data`?

| Pergunta | Resposta | Evidência |
|----------|----------|-----------|
| client_secret can leak through PaymentSession.data? | **Sim** | PaymentIntent Stripe inclui `client_secret` (tipo oficial Stripe). Provider devolve PI integral em `data`; Medusa persiste em JSONB. Store cart default fields incluem `*payment_collection.payment_sessions` (wildcard expõe `data` ao cliente). |

**Risco em duas camadas:**

| Camada | Mecanismo |
|--------|-----------|
| Persistência | `PaymentSession.data.client_secret` gravado em Postgres via Medusa Payment Module |
| Exposição Store API | `defaultStoreCartFields` inclui `*payment_collection.payment_sessions` — sessão completa retornada no GET cart |

**Teste gate:** `stripe-provider-gate.unit.spec.ts` simula `getStatus` com mock sintético e confirma `client_secret` presente no objeto que seria persistido.

---

### 3. Provider Stripe Medusa v2.16.0 permite Pix assíncrono BRL com QR/`expires_at` sem persistência insegura?

| Pergunta | Resposta | Evidência |
|----------|----------|-----------|
| Pix async BRL + QR/instructions/expires_at sem persistência insegura? | **Não (native-first puro)** | Sem service Pix; provider básico usa `capture_method: manual` por default; QR/`expires_at` ficam em `next_action.pix_display_qr_code` dentro do PaymentIntent retornado integralmente em `data`. |

**Detalhes Pix:**

| Aspecto | Observação local |
|---------|------------------|
| Service Pix dedicado | **Ausente** — exports: bancontact, blik, giropay, ideal, oxxo, promptpay, przelewy24, stripe básico |
| Parâmetros Pix via `data` | `normalizePaymentIntentParameters` aceita `payment_method_types`, `automatic_payment_methods`, `payment_method_options` — Pix teoricamente configurável, mas sem contrato Medusa documentado |
| QR / copia-e-cola | Após confirm, Stripe coloca em `next_action.pix_display_qr_code.data` + `expires_at` (tipo Stripe PaymentIntent.NextAction.PixDisplayQrCode) |
| Persistência | Mesmo pipeline: PI integral → `PaymentSession.data` → inclui `client_secret` + QR integral |
| capture_method default | `manual` quando `options.capture !== true` — incompatível com Pix (sem manual capture) |
| Referência async existente | `StripePromptpayService` usa `payment_method_types: ["promptpay"]` + `capture_method: "automatic"` — padrão que Pix deveria seguir, mas não existe equivalente |

**Conclusão Pix:** Stripe API suporta Pix assíncrono; **Medusa native puro não** expõe/consumi de forma segura porque persiste payload integral.

---

### 4. Native-first puro é aceitável ou exige custom provider/camada própria?

| Caminho | Veredicto |
|---------|-----------|
| Native-first **puro** (provider Medusa sem alteração) | **Inaceitável** — viola D-22/D-30 (client_secret persistido) e D-34/D-35 (QR integral persistido) |
| Native-first **com camada de filtragem** | Possível se plano posterior implementar: (a) custom provider que retorna `data` sanitizado, ou (b) wrapper que intercepta resposta imediata, persiste allowlist em PaymentAttempt, e nunca reexpõe `PaymentSession.data` bruto |
| Custom provider Medusa para Pix (+ possivelmente cartão) | **Recomendado** pelo gate — controle explícito de `initiatePayment`/`getStatus` return shape |

```
CUSTOM_PROVIDER_OR_LAYER_REQUIRED=true
```

---

### 5. Cartão native-first é seguro o bastante para seguir para 04-04?

```
NATIVE_CARD_SAFE=false
```

**Motivo:** `client_secret` é necessário na resposta imediata para Stripe.js, mas native-first puro o persiste em `PaymentSession.data` e o Store API default o reexpõe via cart. 04-04 precisa replanejar com filtragem antes de implementar iniciação de cartão.

---

### 6. Pix native-first é seguro o bastante para seguir para 04-05?

```
PIX_NATIVE_SAFE=false
```

**Motivo:** além do vazamento de `client_secret`, QR/copia-e-cola/`expires_at` viriam persistidos integralmente; sem service Pix; default `capture_method: manual` incompatível. **04-05 bloqueado** para replanejamento de custom provider/camada Pix.

---

## Tabela consolidada de gate

| Flag | Valor | Evidência objetiva |
|------|-------|-------------------|
| `NATIVE_CARD_SAFE` | `false` | PI com `client_secret` → `getStatus` → `PaymentSession.data` JSONB |
| `PIX_NATIVE_SAFE` | `false` | Sem StripePixService; QR em `next_action` persistido; manual capture default |
| `CUSTOM_PROVIDER_OR_LAYER_REQUIRED` | `true` | Nenhum mecanismo nativo de filtragem antes da persistência |
| `PAYMENTSESSION_SECRET_PERSISTENCE_BLOCKER` | `true` | `payment-module.js` L163 merge sem redaction |
| `MIGRATION_REQUIRED_FOR_PAYMENTATTEMPT` | `true` | Módulo `payment-attempt` ainda não existe no runtime (somente teste gate) |
| `FUTURE_STRIPE_CONFIG_REQUIRED` | `true` | `apiKey`, `webhookSecret`, `automaticPaymentMethods`/Pix dashboard, `capture` strategy — setup futuro, não criado neste spike |
| `BLOCK_NATIVE_IF_SECRET_PERSISTED` | `true` | Condição satisfeita |

---

## Verificações executadas

### Teste gate

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/payment-attempt/__tests__/stripe-provider-gate.unit.spec.ts
```

### Grep de proibições (escopo 04-01)

```bash
! rg -n "completeCartWorkflow|/store/carts/.*/complete|WebhookEventLog|CheckoutCompletionLog|purchase_completed|gelato|order\.gelatoapis\.com" \
  apps/backend/src/modules/payment-attempt 2>/dev/null
```

Resultado esperado: **nenhum match** — confirmado.

### Escopo respeitado neste plano

| Proibição | Status |
|-----------|--------|
| Order | Não criado |
| Webhook Stripe | Não implementado |
| WebhookEventLog | Não criado |
| CheckoutCompletionLog | Não criado |
| purchase_completed | Não emitido |
| Gelato | Não tocado |
| Stripe config/secrets | Não configurado |
| Migrations | Não executadas |
| PaymentAttempt runtime | Não criado |
| client_secret persistido/logado | Não — apenas mocks sintéticos em teste estático |

---

## Arquivos produzidos

| Arquivo | Propósito |
|---------|-----------|
| `apps/backend/src/modules/payment-attempt/__tests__/stripe-provider-gate.unit.spec.ts` | Prova estática executável — documenta comportamento provider + persistência Medusa |
| `.planning/phases/04-stripe-payments-payment-attempt/04-01-SUMMARY.md` | Decisão de gate e instruções de parada |

---

## Próximos passos permitidos (após revisão humana)

1. **Replanejar 04-04/04-05** com uma das estratégias:
   - Custom `AbstractPaymentProvider` estendendo StripeBase com `getStatus`/`initiatePayment` retornando `data` allowlist-only (`id`, `status`, `amount`, `currency`, `metadata.session_id`).
   - Camada API própria que nunca serializa `PaymentSession.data` bruto ao Store; devolve DTO imediato com `client_secret`/QR e persiste só IDs/`expires_at` em `PaymentAttempt`.
2. **04-02** (PaymentAttempt module + migration) pode ser discutido independentemente — gate confirma `MIGRATION_REQUIRED_FOR_PAYMENTATTEMPT=true`.
3. **Config Stripe** (`FUTURE_STRIPE_CONFIG_REQUIRED=true`): registrar em plano futuro `capture: true` ou `capture_method: automatic` para Pix; habilitar Pix no Dashboard; **não** configurar neste spike.

## Próximos passos bloqueados

- **04-04** (iniciação cartão native-first puro) — bloqueado por `NATIVE_CARD_SAFE=false`
- **04-05** (iniciação Pix native-first puro) — bloqueado por `PIX_NATIVE_SAFE=false`

---

## Issues / limitações do spike

- Evidência é **estática** (leitura de `node_modules` + simulação de `getStatus`); não houve chamada Stripe real nem integração HTTP Medusa — coerente com cercas do plano.
- Upgrade para `@medusajs/payment-stripe@2.17.x` não foi avaliado; versão pinada do workspace é **2.16.0**.

---
*Phase: 04-stripe-payments-payment-attempt*
*Plan: 01 (spike/gate)*
*Completed: 2026-06-29*
*Status: aguardando revisão manual — parar no gate*
