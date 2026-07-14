---
quick_task: 260713-mny01-major-minor-units
status: complete
date: 2026-07-13
scope: hotfix-mny-01
autonomous: false
must_haves:
  truths:
    - "Medusa core e PaymentSession usam BRL em major units."
    - "Stripe e PaymentAttempt usam BRL em minor units."
    - "A conversao major para minor e decimal, exata e falha fechada."
    - "O guard da Order compara Cart major convertido com PaymentAttempt minor."
    - "Nenhuma mutacao de producao, deploy, push, tag ou Phase 12 ocorre."
  artifacts:
    - apps/backend/src/utils/money-units.ts
    - apps/backend/src/modules/payment-attempt/eligibility.ts
    - apps/backend/src/workflows/order/steps/create-order-from-confirmed-attempt.ts
    - apps/backend/src/modules/catalog/gelato-metadata.ts
    - .planning/quick/260713-mny01-major-minor-units/VERIFICATION.md
    - .planning/quick/260713-mny01-major-minor-units/SUMMARY.md
  key_links:
    - "Cart.total major -> eligibility.medusa_amount_major -> PaymentSession.amount"
    - "Cart.total major -> eligibility.provider_amount_minor -> Stripe amount -> PaymentAttempt.amount"
    - "Cart item major -> minor exato -> ORDER_ENTRYPOINT_CART_TOTAL_MISMATCH"
---

# Hotfix MNY-01 — Separar unidades monetárias Medusa × Stripe

## Limites

Executar somente a separação major/minor descrita no prompt aprovado. Permanecem fora de escopo APP_VERSION, Redis, Event Bus, locking, Heroku, warnings de lint, Phase 12, reembolso Medusa core, sincronização de Refund com PaymentCollection, migrations, manifests/lockfile e qualquer mutação de produção ou provider externo.

## Matriz de contrato

| Domínio | Unidade |
|---|---|
| Product/PriceSet/Cart/Order/line items/PaymentSession Medusa | major units |
| Stripe PaymentIntent/Refund | minor units |
| PaymentAttempt/RefundRequest/captured/refunded customizados | minor units |
| Analytics e e-mail financeiros canônicos | minor units |

## Tarefas

### 1. Implementar a fronteira monetária exata

**Arquivos:** `apps/backend/src/utils/money-units.ts`, teste unitário do utilitário, `apps/backend/src/modules/payment-attempt/eligibility.ts`, Card, Pix, `stripe-real.ts` e rota Card.

**Ação:** criar conversão decimal BRL exata com suporte aos formatos Medusa, sem arredondamento silencioso; expor `medusa_amount_major` e `provider_amount_minor`; enviar major à PaymentSession, minor à Stripe e persistir o retorno Stripe minor no PaymentAttempt. Manter a resposta pública `amount` em minor units e rejeitar divergência do provider.

**Verificação:** testes do utilitário, eligibility, Card, Pix, Stripe real e HTTP de payment attempt cobrem `99 -> 9900`, `99.9 -> 9990`, `49.5 x 2 -> 9900`, formatos BigNumber-like, inválidos e mismatch `99` retornado pelo Stripe.

**Done:** nenhuma variável genérica interna cruza simultaneamente as fronteiras Medusa e Stripe; PaymentSession recebe `99` e Stripe/PaymentAttempt recebem `9900`.

### 2. Corrigir Order, catálogo, downstream e fixtures

**Arquivos:** guard de criação da Order, validação/tipos/testes do catálogo, payloads financeiros derivados do Cart e fixtures/testes diretamente afetados em `apps/backend/src` e `apps/backend/integration-tests`.

**Ação:** converter cada componente major para minor antes de multiplicar/somar; preservar `ORDER_ENTRYPOINT_CART_TOTAL_MISMATCH`; aceitar preços major positivos com até duas casas; classificar cada ocorrência de `9900` sem substituição global; preservar PaymentAttempt/refund/analytics/e-mail já minor e impedir dupla conversão.

**Verificação:** testes provam Order `99 x 1` e `49.5 x 2` contra `9900`, rejeitam `99` minor incorreto e `99.999`; catálogo aceita `99`, `99.9`, `0.01` e rejeita zero, negativos, mais de duas casas, NaN e Infinity; integração Card e Pix usa apenas fakes locais e não cria Order antes do webhook.

**Done:** Medusa cria Order com total major, downstream permanece minor onde normativo e nenhuma ocorrência financeira relevante fica ambígua.

### 3. Validar, documentar e encerrar o gate

**Arquivos:** `VERIFICATION.md`, `SUMMARY.md` e `.planning/STATE.md`.

**Ação:** rodar testes focados; suítes unit, modules e HTTP completas com PostgreSQL 16 descartável em `127.0.0.1`; lint, build e `git diff --check`; provar ausência de models, migrations, packages e lockfile; documentar plano manual para preços existentes em produção; criar somente os commits permitidos e não fazer push.

**Verificação:** todos os comandos e contagens ficam registrados em `VERIFICATION.md`; o `SUMMARY.md` classifica apenas `PASS` ou `BLOCKED` e lista os 22 itens do manual gate.

**Done:** gate termina antes de produção, com commits locais atômicos, `.planning/STATE.md` atualizado e divergência final contra `origin/main` reportada.
