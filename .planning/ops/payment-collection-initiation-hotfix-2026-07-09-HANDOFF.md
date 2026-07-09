# PaymentCollection Initiation Hotfix — Handoff — 2026-07-09

## Prompt para nova sessão

Continuar o hotfix interrompido em `/home/jlima/Projetos/ecommerce/Backend`.

Objetivo: corrigir somente o fluxo Store API `POST /store/carts/:id/payment-attempts/card` para que um novo checkout crie/reuse uma `PaymentCollection` Medusa real, crie uma `PaymentSession` Medusa real, grave esses IDs reais no `PaymentAttempt`, preserve um único Stripe PaymentIntent, e permita que o webhook `payment_intent.succeeded` alimente `completeCartWorkflow` sem cair em `Payment collection has not been initiated for cart`.

Escopo/proibições continuam ativos:

- Não iniciar Phase 12.
- Não executar refund smoke.
- Não criar refund Stripe.
- Não usar `sk_live`.
- Não chamar Gelato real.
- Não chamar Correios.
- Não criar Order manualmente no banco.
- Não fazer insert manual em `payment_collection`, `payment_session` ou link tables.
- Não aplicar migration nova sem aprovação explícita.
- Não alterar `package.json`, `package-lock.json` ou `apps/backend/package.json`.
- Não mascarar erro do `completeCartWorkflow`.
- Não tentar consertar PI antigo via SQL manual.
- Não fazer deploy sem aprovação manual.

## Estado do problema

O gate anterior `63904c9` revelou o erro real:

```text
Payment collection has not been initiated for cart
```

Diagnóstico do anexo original:

```text
Stripe PaymentIntent = succeeded
PaymentAttempt = payment_confirmed_by_webhook
Order = nao criada
CheckoutCompletionLog = failed

PaymentAttempt.payment_collection_id = paycol_27757de74ef54dbd
PaymentAttempt.payment_session_id    = payses_card_964a59fdb9cbe8ae2caea1cc

cart_payment_collection = 0 rows
payment_collection      = 0 rows
payment_session         = 0 rows
```

Causa: o fluxo customizado gerava IDs locais/fictícios em `PaymentAttempt`, mas não criava/iniciava a estrutura real que `completeCartWorkflow` exige.

## Subagentes usados

Dois subagentes exploratórios somente leitura foram usados:

- `Kant`: investigou Medusa core-flows/node_modules. Achou `createPaymentCollectionForCartWorkflow`, `createPaymentSessionsWorkflow`, provider id esperado `pp_stripe_stripe`, e confirmou que a Store API oficial consulta `cart_payment_collection` antes de criar collection.
- `Bohr`: auditou testes. Confirmou que os testes atuais mascaravam a diferença entre `PaymentAttempt.payment_session_id` e o ID real de `PaymentSession`, e que faltavam assertions de IDs reais e client_secret do mesmo PI.

## Estratégia WIP escolhida

Ponte estreita para preservar a boundary segura de Phase 04:

1. A rota card cria/reusa `PaymentCollection` real via `createPaymentCollectionForCartWorkflowId` e `cart_payment_collection`.
2. A rota cria uma `PaymentSession` Medusa real antes do Stripe PI.
3. O wrapper Stripe atual continua criando o único PaymentIntent.
4. A criação do PI recebe `payment_session_id` real e grava esse valor em `metadata.session_id`.
5. `PaymentAttempt.payment_collection_id` e `PaymentAttempt.payment_session_id` passam a apontar para IDs reais Medusa.
6. A sessão Medusa é atualizada com dados mínimos e sem `client_secret`.

Importante: esta estratégia usa `paymentModule.createPaymentSession_` em vez de `createPaymentSessionsWorkflow`, porque o workflow oficial chamaria o provider Stripe e poderia criar um segundo PaymentIntent, além de persistir PaymentIntent inteiro em `PaymentSession.data` com `client_secret`. Isso precisa ser revisado cuidadosamente na próxima sessão.

## Arquivos modificados no WIP

```text
apps/backend/src/modules/payment-attempt/card.ts
apps/backend/src/modules/payment-attempt/stripe-real.ts
apps/backend/src/api/store/carts/[id]/payment-attempts/card/route.ts
apps/backend/medusa-config.ts
apps/backend/src/modules/payment-attempt/__tests__/card-initiation.unit.spec.ts
apps/backend/src/modules/payment-attempt/__tests__/stripe-real.unit.spec.ts
apps/backend/integration-tests/http/payment-attempt-store.spec.ts
```

Nenhum `package.json`, lockfile ou migration foi alterado.

## Mudanças já aplicadas

### `card.ts`

- `StripeCardInitiationRequest` agora aceita `payment_session_id?: string | null`.
- `StartCardPaymentAttemptInput` não recebe mais `generatePaymentCollectionId`.
- `StartCardPaymentAttemptInput` agora recebe:

```ts
paymentSession: {
  payment_collection_id: string
  payment_session_id: string
}
```

- `startCardPaymentAttempt` passa `payment_session_id` ao Stripe layer.
- `PaymentAttempt.payment_collection_id` e `PaymentAttempt.payment_session_id` vêm da sessão Medusa real.

### `stripe-real.ts`

- `buildMetadata` usa `request.payment_session_id` como `metadata.session_id` quando presente.
- Fallback antigo `payses_${method}_${digest}` foi preservado para Pix e outros usos.

### `card/route.ts`

Adicionados helpers WIP:

- `fetchPaymentCollectionForCart`
- `ensurePaymentCollectionForCart`
- `resolvePaymentModule`
- `cancelProcessablePaymentSessions`
- `createMedusaCardPaymentSession`
- `buildSafeMedusaPaymentSessionData`
- `updateMedusaPaymentSessionAfterStripeInitiation`
- `cancelMedusaPaymentSession`

Fluxo atual WIP:

```text
fetch cart
resolve actor
assertPaymentStartEligible
list existing PaymentAttempts
resolve Stripe layer
ensure PaymentCollection real for cart
create Medusa PaymentSession real
startCardPaymentAttempt with real paymentSession IDs
update Medusa PaymentSession data/status without client_secret
persist PaymentAttempt
return DTO
```

O último erro de build visto foi:

```text
TS2459: Module '"../../../../../../modules/payment-attempt/card"' declares 'assertPaymentStartEligible' locally, but it is not exported.
```

Esse erro foi corrigido depois do build, movendo o import para:

```ts
import { assertPaymentStartEligible } from "../../../../../../modules/payment-attempt/eligibility"
```

O build ainda nao foi rerodado depois dessa correção porque a sessão foi interrompida.

### `medusa-config.ts`

WIP adicionou registro condicional do módulo Payment Stripe:

```ts
const stripePaymentModule =
  env.STRIPE_REAL_INITIATION_ENABLED && env.STRIPE_SECRET_KEY
    ? [{ resolve: "@medusajs/medusa/payment", options: { providers: [...] } }]
    : []
```

Revisar isto com atenção:

- Pode ser necessário para `Modules.PAYMENT` ter provider `pp_stripe_stripe`.
- Pode ser controverso porque o projeto vinha usando wrapper seguro em vez de native-first puro.
- Não houve alteração de env/package.

### Testes

`card-initiation.unit.spec.ts`:

- Atualizado para passar `MEDUSA_PAYMENT_SESSION`.
- Assertions adicionadas para:
  - `payment_collection_id = paycol_real_01`
  - `payment_session_id = payses_real_01`
  - `provider_payment_session_id = payses_real_01`

`stripe-real.unit.spec.ts`:

- Card passa `paymentSession` real.
- Assertions adicionadas para IDs reais.
- Pix ficou intocado.

`payment-attempt-store.spec.ts`:

- Adicionado estado fake de Medusa payment.
- `remoteQuery` agora responde `cart_payment_collection`.
- Mock de workflow engine cria collection fake.
- Mock de Payment Module cria/atualiza sessão fake.
- Teste principal de card agora espera:
  - workflow `createPaymentCollectionForCartWorkflowId`
  - `createPaymentSession_` com `provider_id: "pp_stripe_stripe"`
  - `updatePaymentSessions` com `id: "payses_http_01"` e `data.id = pi_http_card_mock`
  - `PaymentAttempt` com `pay_col_http_01` e `payses_http_01`

## Validações já feitas

Passou:

```bash
TMPDIR=/tmp npm run test:unit -w @dtc/backend -- --runTestsByPath src/modules/payment-attempt/__tests__/card-initiation.unit.spec.ts
```

Resultado:

```text
PASS src/modules/payment-attempt/__tests__/card-initiation.unit.spec.ts
11 passed
```

Falhou por caminho errado, não por código:

```bash
TMPDIR=/tmp npm run test:unit -w @dtc/backend -- --runTestsByPath apps/backend/src/modules/payment-attempt/__tests__/card-initiation.unit.spec.ts
```

Falhou porque `-w @dtc/backend` já roda dentro de `apps/backend`.

Falhou por suite não encontrada no script unitário:

```bash
TMPDIR=/tmp npm run test:unit -w @dtc/backend -- --runTestsByPath integration-tests/http/payment-attempt-store.spec.ts
```

Ainda precisa descobrir o comando correto para esse arquivo HTTP integration.

Build falhou antes da correção de import:

```bash
HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build -w @dtc/backend
```

Erro corrigido, mas build ainda precisa rerodar.

## Próximos passos recomendados

1. Revisar o diff WIP completo.
2. Rerodar build:

```bash
HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build -w @dtc/backend
```

3. Rodar testes focados obrigatórios com caminhos relativos a `apps/backend`:

```bash
TMPDIR=/tmp npm run test:unit -w @dtc/backend -- --runTestsByPath \
  src/modules/payment-attempt/__tests__/card-initiation.unit.spec.ts \
  src/workflows/order/__tests__/webhook-order-creation.unit.spec.ts
```

4. Rodar suites:

```bash
TMPDIR=/tmp npm run test:unit -w @dtc/backend -- --runInBand src/modules/payment-attempt

TMPDIR=/tmp npm run test:unit -w @dtc/backend -- --runInBand src/workflows/order
```

5. Descobrir/rodar comando correto para:

```text
apps/backend/integration-tests/http/payment-attempt-store.spec.ts
apps/backend/integration-tests/http/stripe-webhook-order-creation.spec.ts
```

Possível ponto de partida:

```bash
TMPDIR=/tmp npm run test:integration:http -w @dtc/backend -- --runTestsByPath integration-tests/http/payment-attempt-store.spec.ts
```

Se o caminho falhar, verificar `apps/backend/jest.config.*` antes de tentar de novo.

6. Se build/testes quebrarem por `PaymentSessionStatus` importado de `@medusajs/framework/utils`, verificar export real. Evidência local indicou `PaymentSessionStatus` em `@medusajs/utils/dist/payment/payment-session.*`, mas outros arquivos Medusa usam via framework utils.
7. Revisar se usar `createPaymentSession_` interno é aceitável. Se não for, a alternativa com `createPaymentSessionsWorkflow` provavelmente cria PI nativo e reabre o risco de duplicação/segredo.
8. Completar summary obrigatório:

```text
.planning/ops/payment-collection-initiation-hotfix-2026-07-08-SUMMARY.md
```

9. Rodar:

```bash
git diff --check
git diff --name-only package.json package-lock.json apps/backend/package.json
```

10. Parar no gate manual. Não fazer deploy.

## Riscos técnicos abertos

- `createPaymentSession_` é método interno/protegido no tipo do Payment Module; funciona em runtime JS se exposto, mas pode ser uma escolha frágil. Build vai confirmar se o uso tipado local passa.
- `updatePaymentSessions` atualiza DB diretamente pelo service gerado, sem provider. Isso é intencional para evitar segundo PI e evitar persistir `client_secret`, mas precisa revisão.
- `completeCartWorkflow` chama `authorizePaymentSession`, que chama o provider com `session.data.id`. O WIP grava `id: providerPaymentIntentId` em `PaymentSession.data` para permitir lookup/status do PI existente.
- Se o provider Stripe não estiver registrado em produção, `authorizePaymentSession` falhará. O WIP adicionou registro condicional em `medusa-config.ts`.
- O provider nativo Stripe, se usado por workflow oficial, persiste PaymentIntent inteiro em `PaymentSession.data`; por isso o WIP evitou `createPaymentSessionsWorkflow`.
- O hotfix ainda não cobre Pix; Pix permanece com IDs fictícios porque o escopo aprovado era card.

## Estado Git no momento do handoff

```text
 M apps/backend/integration-tests/http/payment-attempt-store.spec.ts
 M apps/backend/medusa-config.ts
 M apps/backend/src/api/store/carts/[id]/payment-attempts/card/route.ts
 M apps/backend/src/modules/payment-attempt/__tests__/card-initiation.unit.spec.ts
 M apps/backend/src/modules/payment-attempt/__tests__/stripe-real.unit.spec.ts
 M apps/backend/src/modules/payment-attempt/card.ts
 M apps/backend/src/modules/payment-attempt/stripe-real.ts
```

## Comandos úteis para retomar

```bash
git status --short
git diff -- apps/backend/src/api/store/carts/[id]/payment-attempts/card/route.ts
git diff -- apps/backend/src/modules/payment-attempt/card.ts
git diff -- apps/backend/integration-tests/http/payment-attempt-store.spec.ts
```

## Critério de conclusão

O hotfix só deve ser considerado concluído quando:

- Card initiation cria/reusa PaymentCollection real do cart.
- Card initiation cria PaymentSession real Medusa.
- PaymentAttempt não grava `paycol_*`/`payses_*` fictício gerado localmente.
- `PaymentAttempt.payment_collection_id` corresponde à collection Medusa real.
- `PaymentAttempt.payment_session_id` corresponde à session Medusa real.
- Resposta retorna `client_secret` do mesmo PaymentIntent gravado em `PaymentAttempt`.
- Webhook/order path não encontra mais `Payment collection has not been initiated for cart` em novo smoke.
- Testes/build/diff check passam.
- Summary operacional obrigatório foi criado.
- Gate manual respeitado, sem deploy.
